"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Clock, Loader2, Shirt, ThumbsDown, ThumbsUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { wardrobeItemLabel } from "@/lib/wardrobe/item-label";
import {
  OutfitCollage,
  type CanvasItem,
  type CanvasItemLayout,
} from "@/components/outfit/outfit-canvas";
import {
  DISLIKE_REASONS,
  GESTURE_BY_DIRECTION,
  GESTURE_COPY,
  PROTOTYPE_MODEL_VERSION,
  type CandidateSource,
  type DislikeReason,
  type SwipeDirection,
  type SwipeEventDraft,
  type SwipeGesture,
  type SwipeSurface,
} from "@/lib/swipe/gestures";

export interface SwipeCard {
  id: string;
  title: string;
  subtitle?: string | null;
  items: CanvasItem[];
  layouts: Record<string, CanvasItemLayout>;
}

/** Past this many pixels a release commits instead of springing back. */
const COMMIT_DISTANCE = 96;
/** Below this the card moves but shows no verdict line, so a nudge isn't a vote. */
const HINT_DISTANCE = 24;
const EXIT_MS = 220;

const EXIT_VECTOR: Record<SwipeDirection, [number, number]> = {
  right: [640, -48],
  left: [-640, -48],
  up: [0, -640],
  down: [0, 640],
};

/**
 * The four gestures as circles in the card's own footer, not a separate
 * segmented pill below it — chosen behind an `emil-prototype` picker (see
 * design-tokens.md "Style swipe card") alongside three other card directions,
 * all of which converged on "four circles" as the control shape.
 */
const GESTURE_SEGMENTS: {
  gesture: SwipeGesture;
  direction: SwipeDirection;
  icon: typeof ThumbsUp;
}[] = [
  { gesture: "dislike", direction: "left", icon: ThumbsDown },
  { gesture: "later", direction: "down", icon: Clock },
  { gesture: "wear_now", direction: "up", icon: Shirt },
  { gesture: "like", direction: "right", icon: ThumbsUp },
];

/**
 * The dominant axis wins outright rather than blending, so a diagonal drag
 * resolves to one gesture instead of hovering ambiguously between two.
 */
function dragDirection(dx: number, dy: number, threshold: number): SwipeDirection | null {
  if (Math.abs(dx) >= Math.abs(dy)) {
    if (dx > threshold) return "right";
    if (dx < -threshold) return "left";
    return null;
  }
  if (dy < -threshold) return "up";
  if (dy > threshold) return "down";
  return null;
}

/**
 * Prototype swipe deck: four gestures, a mandatory reason on every left swipe,
 * and an event draft per card. It stores nothing — `onEvent` receives the row
 * that a real `swipe_event` insert would write. The deck never ends: `index`
 * counts every card ever shown (for `position_in_deck`), but rendering wraps
 * it back over `cards` with modulo, so there's always another look to draw.
 */
export function SwipeDeck({
  cards,
  surface,
  candidateSource = "rule",
  onEvent,
}: {
  cards: SwipeCard[];
  surface: SwipeSurface;
  candidateSource?: CandidateSource;
  onEvent?: (event: SwipeEventDraft) => void;
}) {
  const [index, setIndex] = useState(0);
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);
  const [exiting, setExiting] = useState<SwipeDirection | null>(null);
  const [askingReason, setAskingReason] = useState(false);
  const [reasons, setReasons] = useState<DislikeReason[]>([]);
  const [reasonItemId, setReasonItemId] = useState<string | null>(null);

  const startRef = useRef<{ x: number; y: number } | null>(null);
  const shownAtRef = useRef<number>(Date.now());

  const card = cards[index % cards.length];

  useEffect(() => {
    shownAtRef.current = Date.now();
  }, [index]);

  const commit = useCallback(
    (direction: SwipeDirection, reasonTags: DislikeReason[], targetItemId: string | null) => {
      const current = cards[index % cards.length];
      if (!current || exiting) return;

      const event: SwipeEventDraft = {
        outfit_id: current.id,
        item_ids: current.items.map((item) => item.id),
        gesture: GESTURE_BY_DIRECTION[direction],
        reason_tags: reasonTags,
        reason_item_id: targetItemId,
        surface,
        candidate_source: candidateSource,
        model_version: PROTOTYPE_MODEL_VERSION,
        dwell_ms: Date.now() - shownAtRef.current,
        position_in_deck: index,
        created_at: new Date().toISOString(),
      };

      onEvent?.(event);

      setAskingReason(false);
      setReasons([]);
      setReasonItemId(null);
      setDrag(null);
      setExiting(direction);
      window.setTimeout(() => {
        setExiting(null);
        setIndex((previous) => previous + 1);
      }, EXIT_MS);
    },
    [candidateSource, cards, exiting, index, onEvent, surface]
  );

  /** A left swipe is never committed here — §4.2 requires a reason first. */
  const request = useCallback(
    (direction: SwipeDirection) => {
      if (exiting || askingReason) return;
      if (direction === "left") {
        setDrag(null);
        setAskingReason(true);
        return;
      }
      commit(direction, [], null);
    },
    [askingReason, commit, exiting]
  );

  useEffect(() => {
    if (askingReason) return;
    function onKeyDown(event: KeyboardEvent) {
      const keys: Record<string, SwipeDirection> = {
        ArrowRight: "right",
        ArrowLeft: "left",
        ArrowUp: "up",
        ArrowDown: "down",
      };
      const direction = keys[event.key];
      if (!direction) return;
      event.preventDefault();
      request(direction);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [askingReason, request]);

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (exiting || askingReason) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    startRef.current = { x: event.clientX, y: event.clientY };
    setDrag({ dx: 0, dy: 0 });
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!startRef.current) return;
    setDrag({
      dx: event.clientX - startRef.current.x,
      dy: event.clientY - startRef.current.y,
    });
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const current = drag;
    startRef.current = null;
    setDrag(null);
    if (!current) return;
    const direction = dragDirection(current.dx, current.dy, COMMIT_DISTANCE);
    if (direction) request(direction);
  }

  if (cards.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-surface-200 bg-white px-4 py-8 text-center text-xs text-surface-400">
        Save a Look or two in the outfit builder and they&apos;ll show up here to swipe on.
      </p>
    );
  }

  const dx = drag?.dx ?? 0;
  const dy = drag?.dy ?? 0;
  const hint = drag ? dragDirection(dx, dy, HINT_DISTANCE) : null;
  const [exitX, exitY] = exiting ? EXIT_VECTOR[exiting] : [0, 0];

  const style: CSSProperties = exiting
    ? {
        transform: `translate(${exitX}px, ${exitY}px) rotate(${exitX / 40}deg)`,
        opacity: 0,
        transition: `transform ${EXIT_MS}ms ease-in, opacity ${EXIT_MS}ms ease-in`,
      }
    : drag
      ? { transform: `translate(${dx}px, ${dy}px) rotate(${dx / 36}deg)` }
      : { transform: "translate(0px, 0px) rotate(0deg)", transition: "transform 200ms cubic-bezier(0.32, 0.72, 0, 1)" };

  return (
    <div className="mx-auto w-full max-w-sm">
      <div
        style={style}
        className={cn(
          "select-none rounded-md bg-white p-5",
          "border border-border max-lg:border-transparent max-lg:bg-surface-200 max-lg:shadow-[0_1px_2px_rgba(10,10,10,0.05),0_8px_20px_rgba(10,10,10,0.08)]"
        )}
      >
        {/* Pointer handlers stop at the collage + caption — the transform above moves the
            whole card (including the gesture row) as one, but the circles below stay
            outside this element so a tap there can't be captured as a drag. */}
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className={cn("touch-none", drag ? "cursor-grabbing" : "cursor-grab")}
        >
          <OutfitCollage
            items={card.items}
            layouts={card.layouts}
            className="relative aspect-square w-full overflow-hidden rounded-sm bg-surface-50"
          />

          <div className="mt-4 border-t border-border pt-4 text-center">
            <p className="truncate text-subheading font-semibold text-ink">{card.title}</p>
            {card.subtitle && (
              <p className="mt-0.5 truncate text-body-small text-ink-muted">{card.subtitle}</p>
            )}
          </div>

          {hint && (
            <p className="pointer-events-none mt-3 text-center text-label uppercase tracking-wide text-ink">
              {GESTURE_COPY[GESTURE_BY_DIRECTION[hint]].verb}
            </p>
          )}
        </div>

        <div className="mt-4 flex items-center justify-center gap-5 border-t border-border pt-4">
          {GESTURE_SEGMENTS.map((segment) => {
            const copy = GESTURE_COPY[segment.gesture];
            const Icon = segment.icon;
            return (
              <button
                key={segment.gesture}
                type="button"
                onClick={() => request(segment.direction)}
                title={copy.hint}
                aria-label={copy.verb}
                className="flex flex-col items-center gap-1"
              >
                <span className="grid h-10 w-10 place-items-center rounded-full border border-border text-ink-muted transition-colors hover:border-ink hover:text-ink active:scale-[0.96]">
                  <Icon size={16} />
                </span>
                <span className="whitespace-nowrap text-[9px] font-semibold uppercase tracking-wide text-ink-muted">
                  {copy.verb}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {askingReason && (
        <div className="mt-4">
          <ReasonSheet
            items={card.items}
            reasons={reasons}
            reasonItemId={reasonItemId}
            onToggleReason={(reason) =>
              setReasons((previous) =>
                previous.includes(reason)
                  ? previous.filter((value) => value !== reason)
                  : [...previous, reason]
              )
            }
            onPickItem={setReasonItemId}
            onCancel={() => {
              setAskingReason(false);
              setReasons([]);
              setReasonItemId(null);
            }}
            onConfirm={() => commit("left", reasons, reasonItemId)}
          />
        </div>
      )}
    </div>
  );
}

/**
 * §4.2 in UI form. Confirm stays disabled until there is at least one tag, and
 * "don't like this specific item" additionally has to name the piece — that tag
 * without an item id is the exact ambiguity the reasons exist to remove.
 */
function ReasonSheet({
  items,
  reasons,
  reasonItemId,
  onToggleReason,
  onPickItem,
  onCancel,
  onConfirm,
}: {
  items: CanvasItem[];
  reasons: DislikeReason[];
  reasonItemId: string | null;
  onToggleReason: (reason: DislikeReason) => void;
  onPickItem: (id: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const needsItem = reasons.includes("dislike_item");
  const ready = reasons.length > 0 && (!needsItem || Boolean(reasonItemId));

  return (
    <>
      {/* Scrim only below `sm`, where the sheet docks to the bottom edge instead
          of expanding inline under the card — a thumb reaches "Skip this look"
          without first scrolling past the card. */}
      <div className="fixed inset-0 z-40 bg-ink/20 sm:hidden" aria-hidden onClick={onCancel} />
      <div
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-sm rounded-t-md bg-surface-200 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]",
          "sm:static sm:z-auto sm:rounded-md sm:pb-4"
        )}
      >
        <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-border sm:hidden" aria-hidden />
        <p className="text-body font-semibold text-ink">Why not? Pick at least one.</p>
        <p className="mt-0.5 text-body-small text-ink-muted">
          A left swipe with no reason can&apos;t be learned from.
        </p>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {DISLIKE_REASONS.map((reason) => {
            const selected = reasons.includes(reason.id);
            return (
              <button
                key={reason.id}
                type="button"
                onClick={() => onToggleReason(reason.id)}
                className={cn(
                  "rounded-none border px-2.5 py-1.5 text-body-small font-medium transition-colors active:scale-[0.96]",
                  selected
                    ? "border-ink bg-ink text-ink-inverse"
                    : "border-border text-ink-muted hover:text-ink"
                )}
              >
                {reason.label}
              </button>
            );
          })}
        </div>

        {needsItem && (
          <div className="mt-3 border-t border-border pt-3">
            <p className="mb-1.5 text-body-small font-medium text-ink-muted">Which piece?</p>
            <div className="flex flex-wrap gap-1.5">
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onPickItem(item.id)}
                  className={cn(
                    "rounded-none border px-2 py-1.5 text-body-small transition-colors active:scale-[0.96]",
                    reasonItemId === item.id
                      ? "border-ink bg-ink text-ink-inverse"
                      : "border-border text-ink-muted hover:text-ink"
                  )}
                >
                  {wardrobeItemLabel(item)}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-none px-3 py-2 text-button text-ink-muted hover:text-ink active:scale-[0.96]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!ready}
            className="rounded-full bg-ink px-4 py-2 text-button text-ink-inverse transition-opacity hover:opacity-90 active:scale-[0.96] disabled:opacity-40"
          >
            Skip this look
          </button>
        </div>
      </div>
    </>
  );
}

/** Kept so a future real deck can show a loading state without a second import. */
export function SwipeDeckSkeleton() {
  return (
    <div className="flex h-72 items-center justify-center rounded-2xl border border-surface-200 bg-white text-surface-300">
      <Loader2 size={20} className="animate-spin" />
    </div>
  );
}

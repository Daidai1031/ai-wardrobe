"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { ArrowDown, ArrowUp, Check, Loader2, RotateCcw, ThumbsDown, ThumbsUp } from "lucide-react";
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
/** Below this the card moves but shows no verdict badge, so a nudge isn't a vote. */
const HINT_DISTANCE = 24;
const EXIT_MS = 220;

const EXIT_VECTOR: Record<SwipeDirection, [number, number]> = {
  right: [640, -48],
  left: [-640, -48],
  up: [0, -640],
  down: [0, 640],
};

const BADGE_STYLE: Record<SwipeDirection, string> = {
  right: "border-emerald-400 bg-emerald-50 text-emerald-700 -rotate-12 left-4",
  left: "border-red-400 bg-red-50 text-red-600 rotate-12 right-4",
  up: "border-brand-400 bg-brand-50 text-brand-700 left-1/2 -translate-x-1/2",
  down: "border-surface-300 bg-surface-100 text-surface-500 left-1/2 -translate-x-1/2",
};

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
 * that a real `swipe_event` insert would write, and the summary at the end shows
 * it verbatim, which is the whole point of building this before the table.
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
  const [events, setEvents] = useState<SwipeEventDraft[]>([]);

  const startRef = useRef<{ x: number; y: number } | null>(null);
  const shownAtRef = useRef<number>(Date.now());

  const card = cards[index];
  const done = index >= cards.length;

  useEffect(() => {
    shownAtRef.current = Date.now();
  }, [index]);

  const commit = useCallback(
    (direction: SwipeDirection, reasonTags: DislikeReason[], targetItemId: string | null) => {
      const current = cards[index];
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

      setEvents((previous) => [...previous, event]);
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
    if (done || askingReason) return;
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
  }, [askingReason, done, request]);

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

  if (done) {
    return (
      <DeckSummary
        events={events}
        total={cards.length}
        onReset={() => {
          setEvents([]);
          setIndex(0);
        }}
      />
    );
  }

  const dx = drag?.dx ?? 0;
  const dy = drag?.dy ?? 0;
  const hint = drag ? dragDirection(dx, dy, HINT_DISTANCE) : null;
  const [exitX, exitY] = exiting ? EXIT_VECTOR[exiting] : [0, 0];

  const style: CSSProperties = exiting
    ? {
        transform: `translate(${exitX}px, ${exitY}px) rotate(${exitX / 24}deg)`,
        opacity: 0,
        transition: `transform ${EXIT_MS}ms ease-in, opacity ${EXIT_MS}ms ease-in`,
      }
    : drag
      ? { transform: `translate(${dx}px, ${dy}px) rotate(${dx / 22}deg)` }
      : { transform: "translate(0px, 0px) rotate(0deg)", transition: "transform 180ms ease-out" };

  const badgeOpacity = hint
    ? Math.min(1, Math.max(Math.abs(dx), Math.abs(dy)) / COMMIT_DISTANCE)
    : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-[11px] text-surface-400">
        <span>
          {index + 1} / {cards.length}
        </span>
        <span>Drag the card, use the buttons, or press the arrow keys</span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-surface-100">
        <div
          className="h-full rounded-full bg-brand-500 transition-all duration-200"
          style={{ width: `${(index / cards.length) * 100}%` }}
        />
      </div>

      <div className="relative mx-auto w-full max-w-sm" style={{ perspective: 1000 }}>
        {/* Two cards peek from underneath so the deck reads as a stack with depth. */}
        {[2, 1].map((offset) =>
          cards[index + offset] ? (
            <div
              key={cards[index + offset].id}
              aria-hidden
              className="absolute inset-x-0 top-0 rounded-2xl border border-surface-200 bg-white shadow-sm"
              style={{
                transform: `translateY(${offset * 8}px) scale(${1 - offset * 0.035})`,
                height: "100%",
              }}
            />
          ) : null
        )}

        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          style={style}
          className={cn(
            "relative touch-none select-none rounded-2xl border border-surface-200 bg-white p-4 shadow-md",
            drag ? "cursor-grabbing" : "cursor-grab"
          )}
        >
          {hint && (
            <span
              className={cn(
                "absolute top-6 z-20 rounded-lg border-2 px-3 py-1 text-sm font-bold uppercase tracking-wide",
                BADGE_STYLE[hint]
              )}
              style={{ opacity: badgeOpacity }}
            >
              {GESTURE_COPY[GESTURE_BY_DIRECTION[hint]].verb}
            </span>
          )}

          <OutfitCollage items={card.items} layouts={card.layouts} className="bg-white" />

          <div className="mt-3 border-t border-surface-100 pt-3">
            <p className="truncate text-sm font-semibold text-surface-900">{card.title}</p>
            {card.subtitle && (
              <p className="mt-0.5 truncate text-[11px] text-surface-400">{card.subtitle}</p>
            )}
          </div>
        </div>
      </div>

      {askingReason ? (
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
      ) : (
        <div className="flex items-center justify-center gap-3">
          <GestureButton
            gesture="dislike"
            onClick={() => request("left")}
            className="border-red-200 text-red-500 hover:bg-red-50"
          >
            <ThumbsDown size={18} />
          </GestureButton>
          <GestureButton
            gesture="later"
            onClick={() => request("down")}
            className="border-surface-200 text-surface-400 hover:bg-surface-50"
          >
            <ArrowDown size={18} />
          </GestureButton>
          <GestureButton
            gesture="wear_now"
            onClick={() => request("up")}
            className="border-brand-300 bg-brand-50 text-brand-600 hover:bg-brand-100"
          >
            <ArrowUp size={18} />
          </GestureButton>
          <GestureButton
            gesture="like"
            onClick={() => request("right")}
            className="border-emerald-200 text-emerald-600 hover:bg-emerald-50"
          >
            <ThumbsUp size={18} />
          </GestureButton>
        </div>
      )}
    </div>
  );
}

function GestureButton({
  gesture,
  onClick,
  className,
  children,
}: {
  gesture: SwipeGesture;
  onClick: () => void;
  className?: string;
  children: ReactNode;
}) {
  const copy = GESTURE_COPY[gesture];
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${copy.verb} — ${copy.hint}`}
      aria-label={copy.verb}
      className={cn(
        "flex h-12 w-12 items-center justify-center rounded-full border-2 bg-white transition-colors",
        className
      )}
    >
      {children}
    </button>
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
    <div className="mx-auto w-full max-w-sm rounded-xl border border-surface-200 bg-white p-4">
      <p className="text-xs font-semibold text-surface-800">Why not? Pick at least one.</p>
      <p className="mt-0.5 text-[11px] text-surface-400">
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
                "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                selected
                  ? "border-brand-400 bg-brand-50 text-brand-700"
                  : "border-surface-200 text-surface-500 hover:bg-surface-50"
              )}
            >
              {reason.label}
            </button>
          );
        })}
      </div>

      {needsItem && (
        <div className="mt-3 border-t border-surface-100 pt-3">
          <p className="mb-1.5 text-[11px] font-medium text-surface-600">Which piece?</p>
          <div className="flex flex-wrap gap-1.5">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onPickItem(item.id)}
                className={cn(
                  "rounded-lg border px-2 py-1 text-[11px] transition-colors",
                  reasonItemId === item.id
                    ? "border-brand-400 bg-brand-50 text-brand-700"
                    : "border-surface-200 text-surface-500 hover:bg-surface-50"
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
          className="rounded-lg px-3 py-1.5 text-xs font-medium text-surface-500 hover:bg-surface-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={!ready}
          className="rounded-lg bg-surface-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-surface-800 disabled:opacity-40"
        >
          Skip this look
        </button>
      </div>
    </div>
  );
}

function DeckSummary({
  events,
  total,
  onReset,
}: {
  events: SwipeEventDraft[];
  total: number;
  onReset: () => void;
}) {
  const counts = events.reduce<Record<string, number>>((accumulator, event) => {
    accumulator[event.gesture] = (accumulator[event.gesture] ?? 0) + 1;
    return accumulator;
  }, {});

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-surface-800">
        <Check size={16} className="text-emerald-500" /> {total} looks rated
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(Object.keys(GESTURE_COPY) as SwipeGesture[]).map((gesture) => (
          <div key={gesture} className="rounded-xl border border-surface-200 bg-white px-3 py-2.5">
            <p className="text-lg font-semibold text-surface-900">{counts[gesture] ?? 0}</p>
            <p className="text-[11px] text-surface-400">{GESTURE_COPY[gesture].verb}</p>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-surface-200 bg-surface-50 p-3">
        <p className="mb-2 text-[11px] font-medium text-surface-600">
          What a real <code className="text-surface-800">swipe_event</code> insert would have
          written — nothing was saved.
        </p>
        <pre className="max-h-64 overflow-auto rounded-lg bg-white p-3 text-[10px] leading-4 text-surface-600">
          {JSON.stringify(events.slice(-3), null, 2)}
        </pre>
      </div>

      <button
        type="button"
        onClick={onReset}
        className="flex items-center gap-1.5 rounded-lg border border-surface-200 px-3 py-1.5 text-xs font-medium text-surface-600 hover:bg-surface-50"
      >
        <RotateCcw size={13} /> Swipe again
      </button>
    </div>
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

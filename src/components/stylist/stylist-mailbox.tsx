"use client";

/**
 * The client's mailbox to the human stylist, floating over every dashboard page (it is
 * mounted in the dashboard layout). The button starts at the top right and can be dragged
 * anywhere; where it was left is remembered in localStorage.
 *
 * Everything that passes between the two of them lives here, collapsed to one button
 * until opened: her suggestions (which need an answer) and free-text messages (which
 * just need reading). An orange dot on the button means something is waiting — an
 * unanswered suggestion or an unread message.
 *
 * Three tabs:
 *   - New      — unanswered suggestions and messages you haven't read yet.
 *   - History  — everything already answered or read, plus what you sent, newest first.
 *   - Write    — a message to the stylist.
 *
 * Unread messages are marked read the moment the panel opens (so the dot clears) but
 * stay listed under New for the rest of the visit: moving them to History mid-read
 * would make the message you're looking at vanish. Nothing here is live — a reply that
 * arrives while /home is open shows up on the next load.
 */

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Send, X } from "lucide-react";
import { ReviewStrip, type Action } from "@/components/stylist/review-inbox";
import {
  dismissPlanNotice,
  readPlanNotices,
  subscribePlanNotices,
  type PlanNotice,
} from "@/lib/planning/plan-notices";
import type { StylistReviewCard } from "@/lib/stylist/reviews";
import type { StylistMessage } from "@/types/database";
import { cn } from "@/lib/utils";

type Tab = "new" | "history" | "write";

/** The same 28 x 88px tab on the right edge of the screen, on phone and desktop alike. */
const BUTTON_W = 28;
const BUTTON_H = 88;
const EDGE_GAP = 8;
/** Phone: clear of the top bar and of the bottom tab pill (12px + 48px + a gap). */
const PHONE_TOP = 64;
const PHONE_BOTTOM = 84;
/** Movement under this many pixels is a click, not a drag. */
const DRAG_THRESHOLD = 4;
/**
 * A height chosen in a tall desktop window means little on a phone, so each gets its own
 * memory. (The desktop key is new: the old "mailbox-position" held a free x/y for the
 * former corner circle, which no longer applies.)
 */
function positionKey() {
  return window.innerWidth >= 1024 ? "mailbox-position-edge-desktop" : "mailbox-position-edge";
}

function clampToViewport(position: { x: number; y: number }) {
  // The tab only slides up and down the right edge, and always stays on screen.
  const phone = window.innerWidth < 1024;
  const top = phone ? PHONE_TOP : EDGE_GAP;
  const bottom = phone ? PHONE_BOTTOM : EDGE_GAP;
  return {
    x: window.innerWidth - BUTTON_W,
    y: Math.min(Math.max(position.y, top), window.innerHeight - BUTTON_H - bottom),
  };
}

const TABS: { id: Tab; label: string }[] = [
  { id: "new", label: "New" },
  { id: "history", label: "History" },
  { id: "write", label: "Write" },
];

type HistoryEntry =
  | { kind: "review"; at: string; review: StylistReviewCard }
  | { kind: "message"; at: string; message: StylistMessage };

export function StylistMailbox({
  reviews,
  messages,
}: {
  reviews: StylistReviewCard[];
  messages: StylistMessage[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("new");
  const [thread, setThread] = useState<StylistMessage[]>(messages);
  // Fixed at first render: what was unread when the visit began (see the header comment).
  const [unreadAtLoad] = useState(
    () => new Set(messages.filter((m) => m.sender === "stylist" && !m.read_at).map((m) => m.id))
  );
  const [messagesSeen, setMessagesSeen] = useState(false);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  // Planner notices (e.g. repeats a week couldn't avoid) arrive from /plan in this tab.
  // Read after mount so the server render and the first client render match.
  const [notices, setNotices] = useState<PlanNotice[]>([]);
  useEffect(() => {
    setNotices(readPlanNotices());
    return subscribePlanNotices(setNotices);
  }, []);

  // null until the user has moved it: the CSS default (top right) applies, which also keeps
  // the server render and the first client render identical.
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const movedRef = useRef(false);

  useEffect(() => {
    function restore() {
      try {
        const saved = JSON.parse(window.localStorage.getItem(positionKey()) ?? "null");
        setPosition(
          saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)
            ? clampToViewport(saved)
            : null
        );
      } catch {
        // Storage unavailable or corrupt: stay at the default corner.
      }
    }
    restore();
    let wasDesktop = window.innerWidth >= 1024;
    function onResize() {
      const isDesktop = window.innerWidth >= 1024;
      if (isDesktop !== wasDesktop) {
        wasDesktop = isDesktop;
        restore();
        return;
      }
      setPosition((current) => (current ? clampToViewport(current) : current));
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  function onPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: rect.left,
      originY: rect.top,
    };
    movedRef.current = false;
  }

  function onPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!movedRef.current && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    movedRef.current = true;
    setDragging(true);
    setPosition(clampToViewport({ x: drag.originX + dx, y: drag.originY + dy }));
  }

  function onPointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
    setDragging(false);
    if (movedRef.current && position) {
      try {
        window.localStorage.setItem(positionKey(), JSON.stringify(position));
      } catch {
        // Not remembered; it still moved for this visit.
      }
    }
  }

  // A just-declined card is kept out of both lists until the refresh lands, otherwise it
  // would jump to History still labelled "pending".
  const pending = reviews.filter((r) => r.status === "pending" && !dismissed.has(r.id));
  const answered = reviews.filter((r) => r.status !== "pending");
  const newMessages = thread.filter((m) => unreadAtLoad.has(m.id));

  const hasUnreadMessages = unreadAtLoad.size > 0 && !messagesSeen;
  const showDot = pending.length > 0 || hasUnreadMessages || notices.length > 0;
  const newCount = pending.length + newMessages.length + notices.length;

  const history: HistoryEntry[] = [
    ...answered.map((review) => ({ kind: "review" as const, at: review.createdAt, review })),
    ...thread
      .filter((m) => !unreadAtLoad.has(m.id))
      .map((message) => ({ kind: "message" as const, at: message.created_at, message })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function toggleOpen() {
    // The click that ends a drag is not a request to open the panel.
    if (movedRef.current) {
      movedRef.current = false;
      return;
    }
    const next = !open;
    setOpen(next);
    if (next && hasUnreadMessages) {
      setMessagesSeen(true);
      // Best effort: failing to record the read only means the dot returns next visit.
      void fetch("/api/stylist/messages", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
    }
  }

  async function respond(reviewId: string, action: Action) {
    setBusyId(reviewId);
    setError(null);
    try {
      const response = await fetch(`/api/stylist/reviews/${reviewId}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Could not save your answer");

      if (action === "decline") {
        // Nothing outside this card changed, so a card-level dismissal is enough.
        setDismissed((current) => new Set(current).add(reviewId));
        router.refresh();
        return;
      }

      // Accepting or undoing rewrote the day's plan or a saved Look, and the surfaces
      // that render those — DailyRecommendation here, WeekView on /plan — are Client
      // Components holding their own fetched state. router.refresh() re-renders Server
      // Components only, so they'd keep showing the pre-accept outfit until the user
      // happened to reload. A full reload is blunt but it is the only thing that
      // actually re-runs those fetches.
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your answer");
    } finally {
      setBusyId(null);
    }
  }

  async function sendMessage() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    try {
      const response = await fetch("/api/stylist/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Could not send your message");
      setThread((current) => [payload.message as StylistMessage, ...current]);
      setDraft("");
      setTab("history");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send your message");
    } finally {
      setSending(false);
    }
  }

  function toggleExpanded(reviewId: string) {
    setExpandedId((current) => (current === reviewId ? null : reviewId));
  }

  function strip(review: StylistReviewCard) {
    return (
      <ReviewStrip
        key={review.id}
        review={review}
        busy={busyId === review.id}
        expanded={expandedId === review.id}
        onToggle={() => toggleExpanded(review.id)}
        onRespond={(action) => respond(review.id, action)}
      />
    );
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleOpen}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        aria-expanded={open}
        aria-label={showDot ? "Stylist mailbox — something new" : "Stylist mailbox"}
        style={position ? { left: position.x, top: position.y } : undefined}
        className={cn(
          // z-50 keeps it above the panel, so a button dragged over it can't be buried.
          // A slim tab on the right edge with the word set sideways like a book spine,
          // positioned from the TOP so it is on screen wherever the page is scrolled.
          "fixed z-50 flex h-[88px] w-7 touch-none select-none items-center justify-center rounded-l-sm border border-r-0 shadow-[0_6px_16px_rgba(10,10,10,0.2)] transition-colors",
          !position && "right-0 top-[40%]",
          dragging ? "cursor-grabbing" : "cursor-grab",
          // Black, turning white while the panel is open.
          open
            ? "border-ink bg-surface-100 text-ink"
            : "border-ink bg-ink text-ink-inverse"
        )}
      >
        <span className="text-[12px] font-bold uppercase leading-none tracking-[0.14em] [writing-mode:vertical-rl] rotate-180">
          Mail
        </span>
        {showDot && (
          <span
            aria-hidden
            className="absolute -left-[3px] -top-[3px] h-2.5 w-2.5 rounded-full bg-accent ring-2 ring-surface-100"
          />
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Stylist mailbox"
          className="fixed bottom-24 left-4 right-10 top-20 z-40 flex flex-col lg:bottom-6 lg:left-auto lg:right-10 lg:w-[440px] rounded-md bg-surface-100 shadow-[0_1px_2px_rgba(10,10,10,0.05),0_16px_40px_rgba(10,10,10,0.16)]"
        >
          <div className="flex items-center justify-between gap-3 px-5 pt-4">
            <h2 className="font-serif text-heading text-ink">Mailbox</h2>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close mailbox"
              className="p-1 text-ink-muted transition-colors hover:text-ink"
            >
              <X size={16} />
            </button>
          </div>

          <div className="mt-3 flex gap-5 border-b border-border px-5">
            {TABS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={cn(
                  "-mb-px flex items-center gap-1.5 border-b-2 pb-2 text-button transition-colors",
                  tab === id
                    ? "border-ink text-ink"
                    : "border-transparent text-ink-muted hover:text-ink"
                )}
              >
                {label}
                {id === "new" && newCount > 0 && (
                  <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-body-small font-semibold leading-none text-ink-inverse">
                    {newCount}
                  </span>
                )}
              </button>
            ))}
          </div>

          {error && (
            <p className="mx-5 mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </p>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {tab === "new" && (
              <div className="space-y-2">
                {newCount === 0 && (
                  <p className="py-8 text-center text-body text-ink-muted">
                    You&apos;re all caught up.
                  </p>
                )}
                {notices.map((notice) => (
                  <PlanNoticeCard key={notice.id} notice={notice} />
                ))}
                {newMessages.map((message) => (
                  <MessageBubble key={message.id} message={message} />
                ))}
                {pending.map(strip)}
              </div>
            )}

            {tab === "history" && (
              <div className="space-y-2">
                {history.length === 0 && (
                  <p className="py-8 text-center text-body text-ink-muted">
                    Nothing here yet. Suggestions you&apos;ve answered and messages you&apos;ve
                    exchanged will collect here.
                  </p>
                )}
                {history.map((entry) =>
                  entry.kind === "review" ? (
                    strip(entry.review)
                  ) : (
                    <MessageBubble key={entry.message.id} message={entry.message} />
                  )
                )}
              </div>
            )}

            {tab === "write" && (
              <div className="flex flex-col gap-3">
                <label htmlFor="stylist-message" className="text-body text-ink-muted">
                  Ask your stylist something, or tell her what you&apos;re dressing for.
                </label>
                <textarea
                  id="stylist-message"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault();
                      void sendMessage();
                    }
                  }}
                  rows={6}
                  maxLength={2000}
                  placeholder="Write a message…"
                  className="w-full resize-none rounded-sm border border-border bg-white p-3 text-body text-ink focus:border-ink focus:outline-none"
                />
                <div className="flex items-center justify-between gap-3">
                  <span className="text-body-small text-ink-muted">Ctrl/⌘ + Enter to send</span>
                  <button
                    type="button"
                    onClick={() => void sendMessage()}
                    disabled={sending || draft.trim().length === 0}
                    className="flex items-center gap-1.5 rounded-full bg-ink px-4 py-1.5 text-button text-ink-inverse transition-colors hover:opacity-90 disabled:opacity-50"
                  >
                    {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                    Send
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/** A note from the planner itself, not the stylist; dismissing it removes it for the session. */
function PlanNoticeCard({ notice }: { notice: PlanNotice }) {
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-800">
          <AlertTriangle size={13} /> {notice.title}
        </p>
        <button
          type="button"
          onClick={() => dismissPlanNotice(notice.id)}
          aria-label="Dismiss"
          className="p-0.5 text-amber-700 transition-colors hover:text-amber-900"
        >
          <X size={13} />
        </button>
      </div>
      <ul className="mt-1.5 space-y-0.5">
        {notice.lines.map((line) => (
          <li key={line} className="text-[12px] leading-relaxed text-amber-700">
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Hers on the left, yours on the right, with the time under each. */
function MessageBubble({ message }: { message: StylistMessage }) {
  const mine = message.sender === "client";
  return (
    <div className={cn("flex flex-col", mine ? "items-end" : "items-start")}>
      <p
        className={cn(
          "max-w-[85%] whitespace-pre-wrap rounded-md px-3 py-2 text-body leading-relaxed",
          mine ? "bg-ink text-ink-inverse" : "bg-surface-200 text-ink"
        )}
      >
        {message.body}
      </p>
      <p className="mt-0.5 text-body-small text-ink-muted">
        {mine ? "You" : "Your stylist"} ·{" "}
        {new Date(message.created_at).toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })}
      </p>
    </div>
  );
}

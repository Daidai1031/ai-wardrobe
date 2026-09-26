"use client";

/**
 * The stylist's side of the mailbox on the client's /home (schema 23): the thread with
 * this client and a box to reply.
 *
 * Reading the thread marks the client's messages read, which is what stops the
 * unread count on her side — it does not touch the client's own dot, which follows
 * *her* messages.
 */

import { useEffect, useState } from "react";
import { Loader2, Send } from "lucide-react";
import type { StylistMessage } from "@/types/database";
import { cn } from "@/lib/utils";

export function MessagesSection({
  clientId,
  clientName,
  messages,
}: {
  clientId: string;
  clientName: string;
  /** Newest first, as `readMessagesForStylist` returns them. */
  messages: StylistMessage[];
}) {
  const [thread, setThread] = useState<StylistMessage[]>(messages);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unread = messages.filter((m) => m.sender === "client" && !m.read_at).length;

  useEffect(() => {
    if (unread === 0) return;
    // Best effort: failing to record the read only leaves the count up until next visit.
    void fetch("/api/stylist/messages", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId }),
    });
  }, [clientId, unread]);

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    try {
      const response = await fetch("/api/stylist/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, body }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Could not send your message");
      setThread((current) => [payload.message as StylistMessage, ...current]);
      setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send your message");
    } finally {
      setSending(false);
    }
  }

  // Oldest first, so it reads top to bottom like a conversation.
  const ordered = [...thread].reverse();

  return (
    <section className="rounded-2xl border border-surface-200 bg-white p-4">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-surface-900">Messages</h2>
        {unread > 0 && (
          <span className="rounded-full bg-accent px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white">
            {unread} new
          </span>
        )}
      </div>

      {ordered.length === 0 ? (
        <p className="mt-2 text-xs text-surface-400">
          No messages yet. Anything {clientName} writes from their mailbox appears here.
        </p>
      ) : (
        <ul className="mt-3 max-h-72 space-y-2 overflow-y-auto">
          {ordered.map((message) => {
            const mine = message.sender === "stylist";
            return (
              <li key={message.id} className={cn("flex flex-col", mine ? "items-end" : "items-start")}>
                <p
                  className={cn(
                    "max-w-[85%] whitespace-pre-wrap rounded-xl px-3 py-2 text-xs leading-relaxed",
                    mine ? "bg-surface-900 text-white" : "bg-surface-100 text-surface-800"
                  )}
                >
                  {message.body}
                </p>
                <span className="mt-0.5 text-[11px] text-surface-400">
                  {mine ? "You" : clientName} ·{" "}
                  {new Date(message.created_at).toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {error && (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}

      <div className="mt-3 flex items-end gap-2">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void send();
            }
          }}
          rows={2}
          maxLength={2000}
          placeholder={`Reply to ${clientName}…`}
          className="min-w-0 flex-1 resize-none rounded-lg border border-surface-200 px-3 py-2 text-xs focus:border-surface-400 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={sending || draft.trim().length === 0}
          className="flex items-center gap-1.5 rounded-full bg-surface-900 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
        >
          {sending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
          Send
        </button>
      </div>
    </section>
  );
}

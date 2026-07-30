"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Calendar, Check, Loader2, Mail } from "lucide-react";
import { cn } from "@/lib/utils";
import type { GoogleConnectionStatus } from "@/lib/google/client";

/**
 * Calendar and Gmail are two independent consent grants, never one "Connect
 * Google" button (ROADMAP D1): `gmail.readonly` is a restricted scope that needs a
 * paid CASA review once the app leaves Testing mode, and bundling them would mean
 * a user who declines Gmail also loses Calendar. The Gmail row is rendered as
 * unavailable rather than hidden so that separation is visible in the UI, matching
 * how it is actually built — `/api/google/auth?scope=gmail` deliberately 400s today.
 */
export function GoogleConnections({
  status,
  calendarResult,
}: {
  status: GoogleConnectionStatus;
  calendarResult?: string;
}) {
  const router = useRouter();
  const [disconnecting, setDisconnecting] = useState(false);
  const [connecting, setConnecting] = useState(false);

  // The OAuth callback can only communicate through the URL it redirects to, so
  // report the outcome once and strip the flag — otherwise every later refresh of
  // /profile would re-announce a connection the user made minutes ago.
  useEffect(() => {
    if (!calendarResult) return;
    if (calendarResult === "connected") {
      toast.success("Google Calendar connected");
    } else {
      toast.error("Couldn't connect Google Calendar. Please try again.");
    }
    router.replace("/profile");
  }, [calendarResult, router]);

  const hasCalendar = status.connected && status.scopes.some((scope) => scope.includes("calendar"));

  async function disconnect() {
    if (!window.confirm("Disconnect Google Calendar? Daily plans will stop using your events.")) {
      return;
    }

    setDisconnecting(true);
    try {
      const response = await fetch("/api/google/disconnect", { method: "POST" });
      const body = (await response.json()) as { revokedAtGoogle?: boolean; error?: string };
      if (!response.ok) throw new Error(body.error || "Couldn't disconnect Google");

      if (body.revokedAtGoogle) {
        toast.success("Google Calendar disconnected");
      } else {
        // Being honest here matters: the tokens are gone on our side either way, but
        // if the revoke call failed the grant is still listed in their Google account.
        toast.success(
          "Disconnected. Google couldn't confirm the revoke — remove it under your Google account's third-party access if you want it fully cleared."
        );
      }
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't disconnect Google");
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <div className="max-w-2xl rounded-xl border border-surface-200 bg-white p-6">
      <h2 className="text-sm font-semibold text-surface-900">Connected accounts</h2>
      <p className="mt-1 text-xs text-surface-400">
        Each connection is a separate permission you can grant or remove on its own.
      </p>

      <div className="mt-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-surface-200 p-4">
          <div className="flex items-start gap-3">
            <span
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                hasCalendar ? "bg-brand-100 text-brand-700" : "bg-surface-100 text-surface-400"
              )}
            >
              <Calendar size={17} />
            </span>
            <div>
              <p className="text-sm font-medium text-surface-900">Google Calendar</p>
              {status.needsReconnect ? (
                <p className="mt-0.5 flex items-center gap-1.5 text-xs text-amber-700">
                  <AlertTriangle size={12} className="shrink-0" />
                  Access expired — reconnect to keep using your events
                </p>
              ) : hasCalendar ? (
                <p className="mt-0.5 flex items-center gap-1.5 text-xs text-surface-500">
                  <Check size={12} className="shrink-0 text-brand-600" />
                  Read-only access to your events{status.googleEmail ? ` · ${status.googleEmail}` : ""}
                </p>
              ) : (
                <p className="mt-0.5 text-xs text-surface-400">
                  Lets daily plans account for what&apos;s actually on your schedule
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {hasCalendar && !status.needsReconnect && (
              <button
                type="button"
                onClick={() => void disconnect()}
                disabled={disconnecting}
                className="flex items-center gap-1.5 rounded-lg border border-surface-200 px-3 py-2 text-xs font-medium text-surface-600 hover:bg-surface-50 disabled:opacity-50"
              >
                {disconnecting && <Loader2 size={13} className="animate-spin" />}
                {disconnecting ? "Disconnecting…" : "Disconnect"}
              </button>
            )}
            <a
              href="/api/google/auth?scope=calendar"
              onClick={() => setConnecting(true)}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold",
                hasCalendar && !status.needsReconnect
                  ? "border border-surface-200 text-surface-600 hover:bg-surface-50"
                  : "bg-surface-900 text-white hover:bg-surface-800"
              )}
            >
              {connecting && <Loader2 size={13} className="animate-spin" />}
              {status.needsReconnect ? "Reconnect" : hasCalendar ? "Reauthorize" : "Connect"}
            </a>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-surface-200 p-4">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-100 text-surface-400">
              <Mail size={17} />
            </span>
            <div>
              <p className="text-sm font-medium text-surface-500">Gmail</p>
              <p className="mt-0.5 text-xs text-surface-400">
                Will find trips and dress codes from confirmation emails — a separate
                permission from Calendar
              </p>
            </div>
          </div>
          <span className="rounded-full bg-surface-100 px-2.5 py-1 text-[10px] font-semibold text-surface-500">
            Not available yet
          </span>
        </div>
      </div>
    </div>
  );
}

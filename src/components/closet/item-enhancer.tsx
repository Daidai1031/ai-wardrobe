"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Check, Loader2, RotateCcw, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import type { WardrobeItem } from "@/types/database";
import { cn } from "@/lib/utils";

const STAGES = [
  "Reading item references",
  "Generating a cleaner presentation",
  "Removing the new background",
  "Standardizing size and spacing",
];

function formatElapsed(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

interface ItemEnhancerProps {
  item: WardrobeItem;
  className?: string;
  onApplied?: (url: string) => void;
}

export function ItemEnhancer({ item, className, onApplied }: ItemEnhancerProps) {
  const router = useRouter();
  const [status, setStatus] = useState(item.enhancement_status);
  const [candidateUrl, setCandidateUrl] = useState(item.enhancement_candidate_url);
  const [optimizedUrl, setOptimizedUrl] = useState(item.optimized_url);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [stage, setStage] = useState(0);
  const [startedAt, setStartedAt] = useState(item.enhancement_started_at);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const processing = status === "processing";
  const originalDisplayUrl = item.clean_url || item.original_url;
  const currentDisplayUrl = optimizedUrl || originalDisplayUrl;

  useEffect(() => {
    if (!processing) return;
    const tick = () => {
      const parsedStart = startedAt ? Date.parse(startedAt) : Date.now();
      const elapsed = Number.isFinite(parsedStart)
        ? Math.max(0, Math.floor((Date.now() - parsedStart) / 1000))
        : 0;
      setElapsedSeconds(elapsed);
      setStage(elapsed < 8 ? 0 : elapsed < 65 ? 1 : elapsed < 95 ? 2 : 3);
    };
    tick();
    const elapsedTimer = window.setInterval(tick, 1000);
    const pollTimer = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/ai/items/${item.id}/enhance`);
        if (!response.ok) return;
        const data = (await response.json()) as {
          status?: WardrobeItem["enhancement_status"];
          startedAt?: string | null;
          candidateUrl?: string | null;
          optimizedUrl?: string | null;
        };
        if (data.startedAt) setStartedAt(data.startedAt);
        if (data.status) {
          setStatus(data.status);
          if (data.status !== "processing") setStartedAt(null);
          if (data.status === "failed") {
            toast.error("Enhancement stopped before an image was ready. Please try again.");
          }
        }
        if (data.candidateUrl) {
          setCandidateUrl(data.candidateUrl);
          setModalOpen(true);
        }
        if (data.optimizedUrl !== undefined) setOptimizedUrl(data.optimizedUrl);
      } catch {
        // The initiating POST still owns error reporting; polling is best effort.
      }
    }, 3000);
    return () => {
      window.clearInterval(elapsedTimer);
      window.clearInterval(pollTimer);
    };
  }, [item.id, processing, startedAt]);

  useEffect(() => {
    if (item.enhancement_status === "ready" && item.enhancement_candidate_url) {
      setModalOpen(true);
    }
  }, [item.enhancement_candidate_url, item.enhancement_status]);

  async function startEnhancement() {
    setModalOpen(false);
    setStage(0);
    const requestStartedAt = new Date().toISOString();
    setStartedAt(requestStartedAt);
    setElapsedSeconds(0);
    setStatus("processing");
    try {
      const response = await fetch(`/api/ai/items/${item.id}/enhance`, { method: "POST" });
      const data = (await response.json()) as { error?: string; candidateUrl?: string };
      if (!response.ok || !data.candidateUrl) {
        throw new Error(data.error || "Enhancement failed");
      }
      setCandidateUrl(data.candidateUrl);
      setStatus("ready");
      setStartedAt(null);
      setModalOpen(true);
    } catch (error) {
      setStatus("failed");
      setStartedAt(null);
      toast.error(error instanceof Error ? error.message : "Enhancement failed");
    }
  }

  async function acceptCandidate() {
    if (!candidateUrl) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/ai/items/${item.id}/enhance`, { method: "PATCH" });
      const data = (await response.json()) as { error?: string; optimizedUrl?: string };
      if (!response.ok || !data.optimizedUrl) throw new Error(data.error || "Couldn't apply image");
      setOptimizedUrl(data.optimizedUrl);
      setCandidateUrl(null);
      setStatus("complete");
      setModalOpen(false);
      onApplied?.(data.optimizedUrl);
      router.refresh();
      toast.success("Enhanced photo applied");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't apply image");
    } finally {
      setSaving(false);
    }
  }

  async function discardCandidate() {
    setSaving(true);
    try {
      const response = await fetch(`/api/ai/items/${item.id}/enhance?target=candidate`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Couldn't discard preview");
      setCandidateUrl(null);
      setStatus(optimizedUrl ? "complete" : "idle");
      setModalOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't discard preview");
    } finally {
      setSaving(false);
    }
  }

  async function restoreOriginal() {
    setSaving(true);
    try {
      const response = await fetch(`/api/ai/items/${item.id}/enhance`, { method: "DELETE" });
      const data = (await response.json()) as { error?: string; displayUrl?: string };
      if (!response.ok) throw new Error(data.error || "Couldn't restore image");
      const restoredUrl = data.displayUrl || originalDisplayUrl;
      setOptimizedUrl(null);
      setStatus(candidateUrl ? "ready" : "idle");
      setModalOpen(false);
      onApplied?.(restoredUrl);
      router.refresh();
      toast.success("Original photo restored");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't restore image");
    } finally {
      setSaving(false);
    }
  }

  function handleButtonClick(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (processing) return;
    if (candidateUrl || optimizedUrl) setModalOpen(true);
    else void startEnhancement();
  }

  const modal = modalOpen ? (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-surface-950/55 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) setModalOpen(false);
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Review enhanced wardrobe photo"
    >
      <div className="w-full max-w-3xl rounded-2xl bg-white p-4 shadow-2xl sm:p-6">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-surface-900">
              {candidateUrl ? "Review enhancement" : "Enhanced photo"}
            </h2>
            <p className="mt-1 text-xs text-surface-500">
              Check color, buttons, pockets, logo, pattern, and trim before applying.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setModalOpen(false)}
            disabled={saving}
            className="rounded-full p-1.5 text-surface-400 hover:bg-surface-100 hover:text-surface-700"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:gap-5">
          <Preview label={optimizedUrl ? "Current" : "Before"} url={currentDisplayUrl} />
          <Preview
            label={candidateUrl ? "After" : "Original"}
            url={candidateUrl || originalDisplayUrl}
          />
        </div>

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {candidateUrl ? (
            <>
              <button
                type="button"
                onClick={() => void discardCandidate()}
                disabled={saving}
                className="rounded-lg border border-surface-200 px-4 py-2 text-sm font-medium text-surface-600 hover:bg-surface-50 disabled:opacity-50"
              >
                Keep current
              </button>
              <button
                type="button"
                onClick={() => void acceptCandidate()}
                disabled={saving}
                className="flex items-center gap-2 rounded-lg bg-surface-900 px-4 py-2 text-sm font-medium text-white hover:bg-surface-800 disabled:opacity-50"
              >
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                Use enhanced photo
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => void restoreOriginal()}
                disabled={saving}
                className="flex items-center gap-2 rounded-lg border border-surface-200 px-4 py-2 text-sm font-medium text-surface-600 hover:bg-surface-50 disabled:opacity-50"
              >
                {saving ? <Loader2 size={15} className="animate-spin" /> : <RotateCcw size={15} />}
                Restore original
              </button>
              <button
                type="button"
                onClick={() => void startEnhancement()}
                disabled={saving}
                className="flex items-center gap-2 rounded-lg bg-surface-900 px-4 py-2 text-sm font-medium text-white hover:bg-surface-800 disabled:opacity-50"
              >
                <Sparkles size={15} /> Enhance again
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      {processing && (
        <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden bg-white/20">
          <div className="wardrobe-enhance-sweep absolute -inset-y-1/4 w-2/3" />
          <div className="absolute inset-x-2 bottom-2 rounded-lg bg-surface-950/70 px-2 py-1.5 text-center text-[10px] font-medium text-white backdrop-blur-sm">
            <div>{STAGES[stage]}</div>
            <div className="mt-0.5 font-normal text-white/75">
              {formatElapsed(elapsedSeconds)} ·{" "}
              {elapsedSeconds < 100 ? "usually 45–100 seconds" : "taking longer than usual"}
            </div>
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={handleButtonClick}
        disabled={processing}
        title={optimizedUrl || candidateUrl ? "Review or enhance again" : "Enhance photo"}
        aria-label={optimizedUrl || candidateUrl ? "Review enhanced photo" : "Enhance photo"}
        className={cn(
          "absolute z-30 flex h-8 w-8 items-center justify-center rounded-full border border-white/70 bg-white/90 text-brand-600 shadow-md backdrop-blur-sm transition hover:scale-105 hover:bg-white disabled:cursor-wait",
          className
        )}
      >
        {processing ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
      </button>
      {typeof document !== "undefined" && modal ? createPortal(modal, document.body) : null}
    </>
  );
}

function Preview({ label, url }: { label: string; url: string }) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-surface-400">
        {label}
      </p>
      <div className="relative aspect-square overflow-hidden rounded-xl border border-surface-200 bg-surface-50">
        <Image src={url} alt={label} fill className="object-contain p-3" sizes="40vw" unoptimized />
      </div>
    </div>
  );
}

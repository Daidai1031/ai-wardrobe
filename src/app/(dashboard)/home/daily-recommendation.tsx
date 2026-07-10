"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import { toast } from "sonner";
import { Loader2, Cloud, Sparkles, ThumbsUp, ThumbsDown, ListPlus, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

interface DailyItem {
  id: string;
  category: string;
  subcategory: string | null;
  color: string | null;
  brand: string | null;
  clean_url: string | null;
  original_url: string;
}

interface Weather {
  city: string;
  temp: number;
  feels_like: number;
  description: string;
  wind_speed: number;
}

interface DailyResponse {
  weather: Weather | null;
  outfit: { items: DailyItem[]; reasoning: string; gap?: string } | null;
  message?: string;
  error?: string;
}

type Feedback = "liked" | "disliked" | null;

interface CachedPick {
  data: DailyResponse;
  feedback: Feedback;
  savedOutfit: boolean;
}

function todayKey(userId: string) {
  const d = new Date();
  return `daily-pick-${userId}-${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export function DailyRecommendation({ userId }: { userId: string }) {
  const supabase = createClient();
  const [data, setData] = useState<DailyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [savingOutfit, setSavingOutfit] = useState(false);
  const [savedOutfit, setSavedOutfit] = useState(false);

  const persist = useCallback((next: CachedPick) => {
    localStorage.setItem(todayKey(userId), JSON.stringify(next));
  }, [userId]);

  const fetchNew = useCallback(async () => {
    setLoading(true);
    let next: DailyResponse;
    try {
      const res = await fetch("/api/ai/daily");
      next = await res.json();
    } catch {
      next = { weather: null, outfit: null, error: "Something went wrong loading today's pick." };
    }
    setData(next);
    setFeedback(null);
    setSavedOutfit(false);
    persist({ data: next, feedback: null, savedOutfit: false });
    setLoading(false);
  }, [persist]);

  useEffect(() => {
    const cached = localStorage.getItem(todayKey(userId));
    if (cached) {
      try {
        const parsed: CachedPick = JSON.parse(cached);
        setData(parsed.data);
        setFeedback(parsed.feedback ?? null);
        setSavedOutfit(parsed.savedOutfit ?? false);
        setLoading(false);
        return;
      } catch {
        // fall through and fetch fresh
      }
    }
    fetchNew();
    // Only ever load once per mount — today's pick is cached per-day and should
    // not silently regenerate; disliking is the only way to force a new pick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  function like() {
    setFeedback("liked");
    if (data) persist({ data, feedback: "liked", savedOutfit });
  }

  function dislike() {
    fetchNew();
  }

  async function addToOutfit() {
    if (!data?.outfit || data.outfit.items.length < 2) {
      toast.error("Need at least two items to save an outfit");
      return;
    }

    setSavingOutfit(true);
    const fallbackName = `Today's pick · ${new Intl.DateTimeFormat("en", {
      month: "short",
      day: "numeric",
    }).format(new Date())}`;

    const { data: outfit, error: outfitError } = await supabase
      .from("outfits")
      .insert({
        user_id: userId,
        name: fallbackName,
        folder: "Everyday",
        ai_generated: true,
        ai_reasoning: data.outfit.reasoning || null,
      })
      .select("id")
      .single();

    if (outfitError || !outfit) {
      toast.error(outfitError?.message || "Failed to save outfit");
      setSavingOutfit(false);
      return;
    }

    const rows = data.outfit.items.map((item, position) => ({
      outfit_id: outfit.id,
      item_id: item.id,
      position,
    }));

    const { error: itemsError } = await supabase.from("outfit_items").insert(rows);
    if (itemsError) {
      await supabase.from("outfits").delete().eq("id", outfit.id);
      toast.error(itemsError.message || "Failed to attach items to outfit");
      setSavingOutfit(false);
      return;
    }

    toast.success("Saved to your outfits");
    setSavedOutfit(true);
    setSavingOutfit(false);
    persist({ data, feedback, savedOutfit: true });
  }

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-surface-200 p-10 flex flex-col items-center justify-center gap-3 text-surface-400">
        <Loader2 size={24} className="animate-spin text-brand-500" />
        <p className="text-sm">Putting together today's outfit…</p>
      </div>
    );
  }

  if (!data || data.error || data.message || !data.outfit) {
    return (
      <div className="bg-white rounded-xl border border-surface-200 p-8 text-center">
        <p className="text-sm text-surface-500 mb-4">
          {data?.error || data?.message || "No recommendation available."}
        </p>
        <div className="flex justify-center gap-2">
          <Link
            href="/closet"
            className="px-4 py-2 rounded-lg bg-surface-900 text-white text-xs font-medium hover:bg-surface-800"
          >
            Go to closet
          </Link>
          <button
            onClick={fetchNew}
            className="px-4 py-2 rounded-lg border border-surface-200 text-xs font-medium text-surface-600 hover:bg-surface-50"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  const { weather, outfit } = data;

  return (
    <div className="space-y-4">
      {weather && (
        <div className="flex items-center gap-2 text-sm text-surface-600 bg-white rounded-xl border border-surface-200 px-4 py-3 w-fit">
          <Cloud size={16} className="text-brand-500" />
          <span className="font-medium text-surface-900">{weather.temp}°C</span>
          <span className="capitalize">{weather.description}</span>
          <span className="text-surface-400">· {weather.city}</span>
        </div>
      )}

      <div className="bg-white rounded-xl border border-surface-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-surface-800 flex items-center gap-2">
            <Sparkles size={16} className="text-brand-500" /> Today's pick
          </h2>
          <div className="flex items-center gap-1.5">
            <button
              onClick={like}
              title="Like"
              className={cn(
                "p-1.5 rounded-lg border transition-colors",
                feedback === "liked"
                  ? "border-brand-300 bg-brand-50 text-brand-600"
                  : "border-surface-200 text-surface-400 hover:text-surface-700"
              )}
            >
              <ThumbsUp size={14} />
            </button>
            <button
              onClick={dislike}
              title="Dislike — get a new pick"
              className="p-1.5 rounded-lg border border-surface-200 text-surface-400 hover:text-surface-700 transition-colors"
            >
              <ThumbsDown size={14} />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap justify-center gap-2 bg-surface-50 rounded-lg p-6 mb-4">
          {outfit.items.map((item) => (
            <div key={item.id} className="w-28 h-28 relative">
              <Image
                src={item.clean_url || item.original_url}
                alt={item.subcategory || item.category}
                fill
                className="object-contain"
                unoptimized
              />
            </div>
          ))}
        </div>

        <p className="text-sm text-surface-700 leading-relaxed">{outfit.reasoning}</p>

        {outfit.gap && (
          <p className="text-xs text-surface-400 mt-3 pt-3 border-t border-surface-100">
            Wardrobe gap: {outfit.gap}
          </p>
        )}

        <div className="mt-4 pt-4 border-t border-surface-100 flex items-center justify-between">
          <Link href="/stylist" className="text-xs font-medium text-brand-600 hover:text-brand-700">
            Want something else? Ask the AI Stylist →
          </Link>
          <button
            onClick={addToOutfit}
            disabled={savingOutfit || savedOutfit}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-900 text-white text-xs font-medium hover:bg-surface-800 disabled:opacity-50"
          >
            {savedOutfit ? <Check size={13} /> : <ListPlus size={13} />}
            {savedOutfit ? "Saved" : savingOutfit ? "Saving…" : "Add to outfits"}
          </button>
        </div>
      </div>
    </div>
  );
}

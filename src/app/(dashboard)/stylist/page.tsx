"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  CalendarDays,
  Check,
  Clock3,
  Lightbulb,
  Loader2,
  MapPin,
  MessageCircleMore,
  Pencil,
  Save,
  Send,
  Sparkles,
  UserRound,
  Video,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  ClosetPicker,
  OutfitCanvas,
  OutfitCollage,
  defaultLayoutFor,
  readDragPayload,
  type CanvasItemLayout,
} from "@/components/outfit/outfit-canvas";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { ItemCategory } from "@/types/database";
import type {
  StylistBooking,
  StylistLook,
  StylistRecommendationResponse,
  StylistResponse,
  StylistServiceType,
  StylistSlot,
  StylistSlotsResponse,
  StylistWardrobeItem,
} from "@/types/stylist";

interface EditableLook extends StylistLook {
  availableItems: StylistWardrobeItem[];
  layouts: Record<string, CanvasItemLayout>;
  savedOutfitId: string | null;
  dirty: boolean;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  questions?: string[];
  look?: EditableLook;
}

const SUGGESTIONS = [
  "I have a board meeting tomorrow and want to look authoritative, not severe.",
  "Help me dress for a keynote where I will be on stage for an hour.",
  "I need a networking dinner look that feels luxurious but approachable.",
  "Build me a polished casual-Friday look that can handle a lot of walking.",
];

function messageId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function serializeMessage(message: ChatMessage) {
  if (message.look) {
    return `${message.content}
Recommended visual look: ${message.look.name}
Items: ${message.look.items.map((item) => item.id).join(", ")}
Rationale: ${message.look.reasoning.join(" ")}`;
  }
  if (message.questions?.length) {
    return `${message.content}\n${message.questions.join("\n")}`;
  }
  return message.content;
}

export default function StylistPage() {
  const supabase = useMemo(() => createClient(), []);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [savingLookId, setSavingLookId] = useState<string | null>(null);
  const [bookingOpen, setBookingOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, loading]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || loading) return;

    const userMessage: ChatMessage = {
      id: messageId(),
      role: "user",
      content,
    };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);

    try {
      const response = await fetch("/api/ai/stylist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages.map((message) => ({
            role: message.role,
            content: serializeMessage(message),
          })),
        }),
      });
      const data = (await response.json()) as StylistResponse & { error?: string };
      if (!response.ok || data.error) {
        throw new Error(data.error || "The stylist couldn't answer that.");
      }

      if (data.type === "question") {
        setMessages((current) => [
          ...current,
          {
            id: messageId(),
            role: "assistant",
            content: data.reply,
            questions: data.questions,
          },
        ]);
      } else {
        const recommendation = data as StylistRecommendationResponse;
        setMessages((current) => [
          ...current,
          {
            id: messageId(),
            role: "assistant",
            content: recommendation.reply,
            look: {
              ...recommendation.look,
              availableItems: recommendation.availableItems,
              layouts: Object.fromEntries(
                recommendation.look.items.map((item, index) => [
                  item.id,
                  defaultLayoutFor(index),
                ])
              ),
              savedOutfitId: null,
              dirty: true,
            },
          },
        ]);
      }
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: messageId(),
          role: "assistant",
          content: error instanceof Error ? error.message : "Something went wrong. Please try again.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function updateLook(messageIdValue: string, look: EditableLook) {
    setMessages((current) =>
      current.map((message) =>
        message.id === messageIdValue ? { ...message, look } : message
      )
    );
  }

  async function saveLook(message: ChatMessage) {
    const look = message.look;
    if (!look || look.items.length < 2) {
      toast.error("Keep at least two items before saving this look");
      return;
    }
    if (look.savedOutfitId && !look.dirty) return;

    setSavingLookId(message.id);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      toast.error("Sign in again before saving this look");
      setSavingLookId(null);
      return;
    }

    const outfitRows = look.items.map((item, position) => ({
      item_id: item.id,
      position,
      x: look.layouts[item.id]?.x ?? null,
      y: look.layouts[item.id]?.y ?? null,
      width: look.layouts[item.id]?.width ?? null,
    }));
    const reasoning = [look.summary, ...look.reasoning, ...look.stylingNotes].join("\n");
    let outfitId = look.savedOutfitId;

    if (outfitId) {
      const { error: updateError } = await supabase
        .from("outfits")
        .update({
          name: look.name,
          ai_reasoning: reasoning,
          notes: look.gap ? `Wardrobe gap: ${look.gap}` : null,
        })
        .eq("id", outfitId);
      if (updateError) {
        toast.error(updateError.message || "Failed to update this look");
        setSavingLookId(null);
        return;
      }

      const { error: deleteError } = await supabase
        .from("outfit_items")
        .delete()
        .eq("outfit_id", outfitId);
      if (deleteError) {
        toast.error(deleteError.message || "Failed to update the look's items");
        setSavingLookId(null);
        return;
      }
    } else {
      const { data: outfit, error: outfitError } = await supabase
        .from("outfits")
        .insert({
          user_id: user.id,
          name: look.name,
          folder: "Everyday",
          ai_generated: true,
          ai_reasoning: reasoning,
          notes: look.gap ? `Wardrobe gap: ${look.gap}` : null,
        })
        .select("id")
        .single();
      if (outfitError || !outfit) {
        toast.error(outfitError?.message || "Failed to save this look");
        setSavingLookId(null);
        return;
      }
      outfitId = outfit.id;
    }

    const { error: itemsError } = await supabase
      .from("outfit_items")
      .insert(outfitRows.map((row) => ({ ...row, outfit_id: outfitId! })));
    if (itemsError) {
      if (!look.savedOutfitId && outfitId) {
        await supabase.from("outfits").delete().eq("id", outfitId);
      }
      toast.error(itemsError.message || "Failed to attach the look's items");
      setSavingLookId(null);
      return;
    }

    updateLook(message.id, {
      ...look,
      savedOutfitId: outfitId,
      dirty: false,
    });
    setSavingLookId(null);
    toast.success(look.savedOutfitId ? "Saved changes to Looks" : "Saved to Looks");
  }

  return (
    <>
      <div className="flex h-[calc(100vh-3.5rem)] flex-col lg:h-[calc(100vh-2rem)]">
        <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-600">
              Personal styling
            </p>
            <h1 className="flex items-center gap-2 font-display text-2xl font-semibold text-surface-900">
              <Sparkles size={21} className="text-brand-500" /> AI Stylist
            </h1>
            <p className="mt-1 text-sm text-surface-500">
              We&apos;ll understand the brief first, then build an editable look from your closet.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setBookingOpen(true)}
            className="inline-flex items-center gap-2 rounded-xl border border-brand-200 bg-brand-50 px-4 py-2.5 text-sm font-semibold text-brand-800 transition-colors hover:bg-brand-100"
          >
            <UserRound size={16} /> Book a human stylist
          </button>
        </header>

        <div
          ref={scrollRef}
          className="scrollbar-hide flex-1 space-y-5 overflow-y-auto pb-5"
        >
          {messages.length === 0 && (
            <div className="mx-auto max-w-3xl pt-10 text-center sm:pt-16">
              <span className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-100 text-brand-700">
                <MessageCircleMore size={25} />
              </span>
              <h2 className="font-display text-xl font-semibold text-surface-900">
                What are you dressing for?
              </h2>
              <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-surface-500">
                I&apos;ll ask about the details that materially change the look—occasion,
                impression, comfort and practical constraints—then show the answer visually.
              </p>
              <div className="mx-auto mt-6 flex max-w-2xl flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    type="button"
                    key={suggestion}
                    onClick={() => void send(suggestion)}
                    className="rounded-xl border border-surface-200 bg-white px-3.5 py-2.5 text-left text-xs leading-5 text-surface-600 transition-all hover:-translate-y-0.5 hover:border-brand-300 hover:text-brand-700 hover:shadow-sm"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message) => (
            <div
              key={message.id}
              className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}
            >
              {message.look ? (
                <RecommendationCard
                  message={message}
                  saving={savingLookId === message.id}
                  onChange={(look) => updateLook(message.id, look)}
                  onSave={() => void saveLook(message)}
                />
              ) : (
                <div
                  className={cn(
                    "max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-6 lg:max-w-[72%]",
                    message.role === "user"
                      ? "rounded-br-sm bg-surface-900 text-white"
                      : "rounded-bl-sm border border-surface-200 bg-white text-surface-800"
                  )}
                >
                  <p className="whitespace-pre-wrap">{message.content}</p>
                  {message.questions && message.questions.length > 0 && (
                    <ol className="mt-3 space-y-2 border-t border-surface-100 pt-3">
                      {message.questions.map((question, index) => (
                        <li key={question} className="flex gap-2 text-surface-700">
                          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[10px] font-semibold text-brand-700">
                            {index + 1}
                          </span>
                          <span>{question}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-2xl rounded-bl-sm border border-surface-200 bg-white px-4 py-3 text-xs text-surface-500">
                <Loader2 size={15} className="animate-spin text-brand-500" />
                Thinking through the brief and your closet…
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-surface-200 bg-surface-50 pt-3">
          <div className="flex gap-2">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send(input);
                }
              }}
              rows={1}
              placeholder={
                messages.at(-1)?.questions
                  ? "Answer in your own words…"
                  : "Tell your stylist what you need…"
              }
              className="min-h-11 flex-1 resize-none rounded-xl border border-surface-200 bg-white px-4 py-2.5 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20"
            />
            <button
              type="button"
              onClick={() => void send(input)}
              disabled={loading || !input.trim()}
              aria-label="Send message"
              className="flex h-11 w-11 items-center justify-center rounded-xl bg-surface-900 text-white transition-colors hover:bg-surface-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </div>
        </div>
      </div>

      {bookingOpen && <BookingModal onClose={() => setBookingOpen(false)} />}
    </>
  );
}

function RecommendationCard({
  message,
  saving,
  onChange,
  onSave,
}: {
  message: ChatMessage;
  saving: boolean;
  onChange: (look: EditableLook) => void;
  onSave: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const look = message.look!;

  if (editing) {
    return (
      <div className="w-full rounded-2xl border border-surface-200 bg-white p-4 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-600">
              Editing visual look
            </p>
            <h2 className="mt-0.5 text-sm font-semibold text-surface-900">{look.name}</h2>
          </div>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-surface-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-surface-800"
          >
            <Check size={14} /> Done editing
          </button>
        </div>
        <StylistCanvasEditor look={look} onChange={onChange} />
      </div>
    );
  }

  return (
    <article className="w-full overflow-hidden rounded-2xl border border-surface-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-surface-100 bg-surface-50 px-5 py-4">
        <div>
          <p className="text-xs text-surface-500">{message.content}</p>
          <h2 className="mt-1 font-display text-xl font-semibold text-surface-900">{look.name}</h2>
          <p className="mt-1 text-xs text-surface-400">
            Built from {look.items.length} pieces in your closet
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-surface-200 bg-white px-3 py-2 text-xs font-semibold text-surface-600 hover:bg-surface-100"
          >
            <Pencil size={13} /> Edit canvas
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving || look.items.length < 2 || Boolean(look.savedOutfitId && !look.dirty)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-xs font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? (
              <Loader2 size={13} className="animate-spin" />
            ) : look.savedOutfitId && !look.dirty ? (
              <Check size={13} />
            ) : (
              <Save size={13} />
            )}
            {saving
              ? "Saving…"
              : look.savedOutfitId && !look.dirty
                ? "Saved"
                : look.savedOutfitId
                  ? "Save changes"
                  : "Save to Looks"}
          </button>
        </div>
      </div>

      <div className="grid gap-6 p-5 md:grid-cols-[minmax(260px,0.85fr)_minmax(0,1.15fr)]">
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-surface-500">
            <Sparkles size={13} className="text-brand-500" /> Visual canvas
          </p>
          <OutfitCollage items={look.items} layouts={look.layouts} />
        </div>

        <div className="space-y-5">
          <div>
            <h3 className="text-sm font-semibold text-surface-900">The idea</h3>
            <p className="mt-1.5 text-sm leading-6 text-surface-600">{look.summary}</p>
          </div>

          {look.reasoning.length > 0 && (
            <div>
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-surface-900">
                <Lightbulb size={14} className="text-amber-500" /> Why it works
              </h3>
              <ul className="mt-2 space-y-2">
                {look.reasoning.map((reason) => (
                  <li key={reason} className="flex gap-2 text-xs leading-5 text-surface-600">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400" />
                    {reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {look.stylingNotes.length > 0 && (
            <div className="rounded-xl bg-brand-50 p-3.5">
              <h3 className="text-xs font-semibold text-brand-800">Finish the look</h3>
              <ul className="mt-2 space-y-1.5">
                {look.stylingNotes.map((note) => (
                  <li key={note} className="text-xs leading-5 text-brand-800/80">
                    {note}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {look.gap && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
              Wardrobe gap: {look.gap}
            </p>
          )}

          <Link href="/outfits" className="inline-flex text-xs font-semibold text-brand-600 hover:text-brand-700">
            Open Saved Looks →
          </Link>
        </div>
      </div>
    </article>
  );
}

function StylistCanvasEditor({
  look,
  onChange,
}: {
  look: EditableLook;
  onChange: (look: EditableLook) => void;
}) {
  const [activeCategory, setActiveCategory] = useState<ItemCategory | "All">("All");
  const [search, setSearch] = useState("");
  const [isCanvasOver, setIsCanvasOver] = useState(false);
  const selectedIds = look.items.map((item) => item.id);
  const pickerItems = look.availableItems.filter((item) => {
    if (selectedIds.includes(item.id)) return false;
    const inCategory = activeCategory === "All" || item.category === activeCategory;
    const query = search.trim().toLowerCase();
    const matchesSearch =
      !query ||
      [item.display_name, item.user_notes, item.subcategory, item.category, item.color, item.brand]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(query));
    return inCategory && matchesSearch;
  });

  function commit(items: StylistWardrobeItem[], layouts = look.layouts) {
    onChange({ ...look, items, layouts, dirty: true });
  }

  function addItem(itemId: string, layout?: CanvasItemLayout) {
    if (selectedIds.includes(itemId)) return;
    const item = look.availableItems.find((candidate) => candidate.id === itemId);
    if (!item) return;
    commit([...look.items, item], {
      ...look.layouts,
      [itemId]: layout || defaultLayoutFor(look.items.length),
    });
  }

  function removeItem(itemId: string) {
    const layouts = { ...look.layouts };
    delete layouts[itemId];
    commit(
      look.items.filter((item) => item.id !== itemId),
      layouts
    );
  }

  function moveItem(from: number, to: number) {
    if (from === to || from < 0 || to < 0 || from >= look.items.length || to >= look.items.length) {
      return;
    }
    const items = [...look.items];
    const [moved] = items.splice(from, 1);
    items.splice(to, 0, moved);
    commit(items);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsCanvasOver(false);
    const payload = readDragPayload(event);
    if (payload?.source !== "closet") return;

    const rect = event.currentTarget.getBoundingClientRect();
    const width = 28;
    const itemHeight = (width * rect.width) / rect.height;
    const x = Math.max(
      0,
      Math.min(100 - width, ((event.clientX - rect.left) / rect.width) * 100 - width / 2)
    );
    const y = Math.max(
      0,
      Math.min(100 - itemHeight, ((event.clientY - rect.top) / rect.height) * 100 - itemHeight / 2)
    );
    addItem(payload.itemId, { x, y, width });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <ClosetPicker
        items={pickerItems}
        activeCategory={activeCategory}
        search={search}
        onSearch={setSearch}
        onCategory={setActiveCategory}
        onAdd={addItem}
        minHeightClass="min-h-[420px]"
        maxListHeightClass="max-h-[420px]"
      />
      <OutfitCanvas
        items={look.items}
        layouts={look.layouts}
        isOver={isCanvasOver}
        onOver={setIsCanvasOver}
        onDrop={handleDrop}
        onRemove={removeItem}
        onMove={moveItem}
        onLayoutChange={(id, layout) =>
          commit(look.items, { ...look.layouts, [id]: layout })
        }
      />
    </div>
  );
}

const SERVICES: {
  type: StylistServiceType;
  name: string;
  detail: string;
  icon: typeof Video;
}[] = [
  {
    type: "online_30",
    name: "30-minute online session",
    detail: "Focused video consultation for one event, outfit decision or wardrobe question.",
    icon: Video,
  },
  {
    type: "in_person_day",
    name: "Full-day in-person styling",
    detail: "An immersive 9–5 session for wardrobe editing, outfit building and hands-on styling.",
    icon: MapPin,
  },
];

function BookingModal({ onClose }: { onClose: () => void }) {
  const [serviceType, setServiceType] = useState<StylistServiceType>("online_30");
  const [slots, setSlots] = useState<StylistSlot[]>([]);
  const [timeZone, setTimeZone] = useState("UTC");
  const [scheduleTimeZone, setScheduleTimeZone] = useState("America/New_York");
  const [selectedStart, setSelectedStart] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [booking, setBooking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<StylistBooking | null>(null);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !booking) onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [booking, onClose]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSelectedStart(null);
    const detectedTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

    fetch(
      `/api/stylist/bookings?service=${serviceType}&timezone=${encodeURIComponent(detectedTimeZone)}`
    )
      .then(async (response) => {
        const data = (await response.json()) as StylistSlotsResponse & { error?: string };
        if (!response.ok) throw new Error(data.error || "Couldn't load availability");
        if (!cancelled) {
          setSlots(data.slots);
          setTimeZone(data.timezone);
          setScheduleTimeZone(data.scheduleTimezone);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setSlots([]);
          setError(loadError instanceof Error ? loadError.message : "Couldn't load availability");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [serviceType]);

  const groupedSlots = slots.reduce<Record<string, StylistSlot[]>>((groups, slot) => {
    (groups[slot.dateLabel] ||= []).push(slot);
    return groups;
  }, {});
  const selectedSlot = slots.find((slot) => slot.startsAt === selectedStart);
  const selectedService = SERVICES.find((service) => service.type === serviceType)!;

  async function confirmBooking() {
    if (!selectedStart || booking) return;
    setBooking(true);
    setError(null);

    try {
      const response = await fetch("/api/stylist/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceType, startsAt: selectedStart, timezone: timeZone }),
      });
      const data = (await response.json()) as StylistBooking & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error || "Booking failed");
      setConfirmed(data);
      toast.success("Stylist session booked");
    } catch (bookingError) {
      setError(bookingError instanceof Error ? bookingError.message : "Booking failed");
      if (
        bookingError instanceof Error &&
        (bookingError.message.includes("just booked") ||
          bookingError.message.includes("no longer"))
      ) {
        setSlots((current) => current.filter((slot) => slot.startsAt !== selectedStart));
        setSelectedStart(null);
      }
    } finally {
      setBooking(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-surface-950/45 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="booking-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !booking) onClose();
      }}
    >
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-surface-100 bg-white px-5 py-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-600">
              Human stylist
            </p>
            <h2 id="booking-title" className="mt-0.5 font-display text-xl font-semibold text-surface-900">
              {confirmed ? "Your session is booked" : "Choose a service and time"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={booking}
            aria-label="Close booking"
            className="flex h-8 w-8 items-center justify-center rounded-full text-surface-400 hover:bg-surface-100 hover:text-surface-700 disabled:opacity-50"
          >
            <X size={17} />
          </button>
        </div>

        {confirmed ? (
          <div className="p-6 sm:p-8">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
              <Check size={25} />
            </div>
            <div className="mx-auto mt-5 max-w-md text-center">
              <h3 className="font-display text-xl font-semibold text-surface-900">
                {SERVICES.find((service) => service.type === confirmed.serviceType)?.name}
              </h3>
              <p className="mt-2 text-sm text-surface-600">
                {confirmed.dateLabel} · {confirmed.timeLabel}
              </p>
              <p className="mt-1 text-xs text-surface-400">{confirmed.timezone}</p>
              <p className="mt-5 rounded-xl bg-surface-50 p-4 text-xs leading-5 text-surface-500">
                Your appointment is confirmed. Calendar invitation and meeting or location
                details will follow from the styling team.
              </p>
              <button
                type="button"
                onClick={onClose}
                className="mt-5 rounded-lg bg-surface-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-surface-800"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-6 p-5 sm:p-6">
              <div className="grid gap-3 sm:grid-cols-2">
                {SERVICES.map((service) => {
                  const Icon = service.icon;
                  const active = serviceType === service.type;
                  return (
                    <button
                      type="button"
                      key={service.type}
                      onClick={() => setServiceType(service.type)}
                      className={cn(
                        "rounded-xl border p-4 text-left transition-all",
                        active
                          ? "border-brand-400 bg-brand-50 ring-2 ring-brand-100"
                          : "border-surface-200 hover:border-surface-300 hover:bg-surface-50"
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <span
                          className={cn(
                            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                            active
                              ? "bg-brand-600 text-white"
                              : "bg-surface-100 text-surface-500"
                          )}
                        >
                          <Icon size={17} />
                        </span>
                        <div>
                          <p className="text-sm font-semibold text-surface-900">{service.name}</p>
                          <p className="mt-1 text-xs leading-5 text-surface-500">{service.detail}</p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              <section>
                <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <h3 className="flex items-center gap-1.5 text-sm font-semibold text-surface-900">
                      <CalendarDays size={15} className="text-brand-600" /> Available slots
                    </h3>
                    <p className="mt-1 text-xs text-surface-400">
                      Times shown in {timeZone}. The service calendar is based in{" "}
                      {scheduleTimeZone}; full-day sessions run 9:00 AM–5:00 PM there.
                    </p>
                  </div>
                </div>

                {loading ? (
                  <div className="flex min-h-48 items-center justify-center gap-2 rounded-xl bg-surface-50 text-xs text-surface-500">
                    <Loader2 size={16} className="animate-spin text-brand-500" />
                    Checking the stylist&apos;s calendar…
                  </div>
                ) : error ? (
                  <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                    {error}
                  </div>
                ) : slots.length === 0 ? (
                  <div className="rounded-xl bg-surface-50 p-6 text-center text-sm text-surface-500">
                    No open slots in this window. Try the other service or check back soon.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {Object.entries(groupedSlots).map(([dateLabel, dateSlots]) => (
                      <div key={dateLabel}>
                        <p className="mb-2 text-xs font-semibold text-surface-600">{dateLabel}</p>
                        <div className="flex flex-wrap gap-2">
                          {dateSlots.map((slot) => {
                            const selected = selectedStart === slot.startsAt;
                            return (
                              <button
                                type="button"
                                key={slot.startsAt}
                                onClick={() => setSelectedStart(slot.startsAt)}
                                className={cn(
                                  "inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors",
                                  selected
                                    ? "border-surface-900 bg-surface-900 text-white"
                                    : "border-surface-200 bg-white text-surface-600 hover:border-brand-300 hover:text-brand-700"
                                )}
                              >
                                <Clock3 size={13} /> {slot.timeLabel}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>

            <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-surface-100 bg-white px-5 py-4">
              <div className="text-xs text-surface-500">
                {selectedSlot ? (
                  <>
                    <span className="font-semibold text-surface-800">{selectedService.name}</span>
                    <span className="block mt-0.5">
                      {selectedSlot.dateLabel} · {selectedSlot.timeLabel}
                    </span>
                  </>
                ) : (
                  "Select a time to continue"
                )}
              </div>
              <button
                type="button"
                onClick={() => void confirmBooking()}
                disabled={!selectedSlot || booking}
                className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {booking ? <Loader2 size={15} className="animate-spin" /> : <CalendarDays size={15} />}
                {booking ? "Booking…" : "Confirm booking"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

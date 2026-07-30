"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Profile, BodyShape } from "@/types/database";
import { Save, User } from "lucide-react";
import { toast } from "sonner";

const BODY_SHAPES: { value: BodyShape; label: string }[] = [
  { value: "pear", label: "Pear" },
  { value: "apple", label: "Apple" },
  { value: "hourglass", label: "Hourglass" },
  { value: "rectangle", label: "Rectangle" },
  { value: "inverted_triangle", label: "Inverted Triangle" },
];

// Curated, not exhaustive (ROADMAP D4) — one representative IANA zone per common UTC
// offset/region, not the full ~400-zone Intl.supportedValuesOf("timeZone") list. Feeds
// day-bucket.ts's eventsOnLocalDay() via GET /api/ai/daily so calendar occasions land
// on the correct local day.
const COMMON_TIMEZONES: { value: string; label: string }[] = [
  { value: "Pacific/Honolulu", label: "Hawaii (Honolulu)" },
  { value: "America/Anchorage", label: "Alaska (Anchorage)" },
  { value: "America/Los_Angeles", label: "Pacific Time (Los Angeles)" },
  { value: "America/Denver", label: "Mountain Time (Denver)" },
  { value: "America/Chicago", label: "Central Time (Chicago)" },
  { value: "America/New_York", label: "Eastern Time (New York)" },
  { value: "America/Sao_Paulo", label: "São Paulo" },
  { value: "Europe/London", label: "London" },
  { value: "Europe/Paris", label: "Central Europe (Paris, Berlin)" },
  { value: "Europe/Athens", label: "Eastern Europe (Athens, Helsinki)" },
  { value: "Europe/Moscow", label: "Moscow" },
  { value: "Asia/Dubai", label: "Dubai" },
  { value: "Asia/Karachi", label: "Karachi" },
  { value: "Asia/Kolkata", label: "India (Kolkata)" },
  { value: "Asia/Dhaka", label: "Dhaka" },
  { value: "Asia/Bangkok", label: "Bangkok" },
  { value: "Asia/Shanghai", label: "China / Singapore (Shanghai)" },
  { value: "Asia/Tokyo", label: "Japan / Korea (Tokyo)" },
  { value: "Australia/Sydney", label: "Sydney" },
  { value: "Pacific/Auckland", label: "Auckland" },
];

export function ProfileForm({ profile }: { profile: Profile | null }) {
  const router = useRouter();
  const supabase = createClient();
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    name: profile?.name || "",
    city: profile?.city || "",
    timezone: profile?.timezone || "",
    height_cm: profile?.height_cm || "",
    weight_kg: profile?.weight_kg || "",
    body_shape: profile?.body_shape || "",
    bust_cm: profile?.bust_cm || "",
    waist_cm: profile?.waist_cm || "",
    hip_cm: profile?.hip_cm || "",
    skin_tone: profile?.skin_tone || "",
    hair_color: profile?.hair_color || "",
    hair_length: profile?.hair_length || "",
  });

  function update(key: string, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);

    // Re-geocode when the city text changed, or when it hasn't but we still have no
    // coordinates for it (e.g. a profile whose city was saved before lat/lng existed).
    // Coordinates barely ever change for a given city name, so this stays a one-time
    // lookup per edit, not a per-save (let alone per-weather-fetch) cost.
    const cityChanged = form.city !== (profile?.city || "");
    const missingCoords = !!form.city && (profile?.lat == null || profile?.lng == null);
    let geo: { lat: number | null; lng: number | null } = {
      lat: profile?.lat ?? null,
      lng: profile?.lng ?? null,
    };
    if (cityChanged || missingCoords) {
      if (form.city) {
        const res = await fetch(`/api/geocode?city=${encodeURIComponent(form.city)}`);
        const data = res.ok ? await res.json() : null;
        geo = { lat: data?.lat ?? null, lng: data?.lon ?? null };
        if (!data) toast.error("Couldn't locate that city — saved anyway, but weather won't work for it yet");
      } else {
        geo = { lat: null, lng: null };
      }
    }

    const { error } = await supabase
      .from("profiles")
      .update({
        name: form.name || null,
        city: form.city || null,
        lat: geo.lat,
        lng: geo.lng,
        timezone: form.timezone || null,
        height_cm: form.height_cm ? Number(form.height_cm) : null,
        weight_kg: form.weight_kg ? Number(form.weight_kg) : null,
        body_shape: form.body_shape || null,
        bust_cm: form.bust_cm ? Number(form.bust_cm) : null,
        waist_cm: form.waist_cm ? Number(form.waist_cm) : null,
        hip_cm: form.hip_cm ? Number(form.hip_cm) : null,
        skin_tone: form.skin_tone || null,
        hair_color: form.hair_color || null,
        hair_length: form.hair_length || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", profile?.id);

    if (error) {
      toast.error("Failed to save profile");
    } else {
      toast.success("Profile saved");
      router.refresh();
    }
    setSaving(false);
  }

  const inputClass = "w-full px-3 py-2 rounded-lg border border-surface-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 bg-white";
  const labelClass = "block text-xs font-medium text-surface-600 mb-1";

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-full bg-brand-100 flex items-center justify-center">
          <User size={18} className="text-brand-600" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-surface-900">Profile</h1>
          <p className="text-sm text-surface-500">Your styling foundation</p>
        </div>
      </div>

      <div className="space-y-8">
        {/* Basic */}
        <section>
          <h2 className="text-sm font-semibold text-surface-700 mb-3">Basic Info</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Name</label>
              <input value={form.name} onChange={(e) => update("name", e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>City</label>
              <input value={form.city} onChange={(e) => update("city", e.target.value)} className={inputClass} placeholder="For weather-based styling" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <div>
              <label className={labelClass}>Timezone</label>
              <select value={form.timezone} onChange={(e) => update("timezone", e.target.value)} className={inputClass}>
                <option value="">Select…</option>
                {COMMON_TIMEZONES.map((tz) => (
                  <option key={tz.value} value={tz.value}>{tz.label}</option>
                ))}
              </select>
              <p className="text-xs text-surface-400 mt-1">Used to line up calendar events with the right day for daily/weekly outfit planning.</p>
            </div>
          </div>
        </section>

        {/* Body */}
        <section>
          <h2 className="text-sm font-semibold text-surface-700 mb-3">Body Profile</h2>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelClass}>Height (cm)</label>
              <input type="number" value={form.height_cm} onChange={(e) => update("height_cm", e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Weight (kg) <span className="text-surface-400">optional</span></label>
              <input type="number" value={form.weight_kg} onChange={(e) => update("weight_kg", e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Body Shape</label>
              <select value={form.body_shape} onChange={(e) => update("body_shape", e.target.value)} className={inputClass}>
                <option value="">Select…</option>
                {BODY_SHAPES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 mt-3">
            <div>
              <label className={labelClass}>Bust (cm) <span className="text-surface-400">optional</span></label>
              <input type="number" value={form.bust_cm} onChange={(e) => update("bust_cm", e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Waist (cm) <span className="text-surface-400">optional</span></label>
              <input type="number" value={form.waist_cm} onChange={(e) => update("waist_cm", e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Hip (cm) <span className="text-surface-400">optional</span></label>
              <input type="number" value={form.hip_cm} onChange={(e) => update("hip_cm", e.target.value)} className={inputClass} />
            </div>
          </div>
        </section>

        {/* Appearance */}
        <section>
          <h2 className="text-sm font-semibold text-surface-700 mb-3">
            Appearance <span className="font-normal text-surface-400">(optional, for future avatar)</span>
          </h2>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelClass}>Skin Tone</label>
              <input value={form.skin_tone} onChange={(e) => update("skin_tone", e.target.value)} className={inputClass} placeholder="e.g. fair, medium, dark" />
            </div>
            <div>
              <label className={labelClass}>Hair Color</label>
              <input value={form.hair_color} onChange={(e) => update("hair_color", e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Hair Length</label>
              <input value={form.hair_length} onChange={(e) => update("hair_length", e.target.value)} className={inputClass} placeholder="short, medium, long" />
            </div>
          </div>
        </section>

        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-surface-900 text-white text-sm font-medium hover:bg-surface-800 disabled:opacity-50"
        >
          <Save size={15} />
          {saving ? "Saving…" : "Save profile"}
        </button>
      </div>
    </div>
  );
}

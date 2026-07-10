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

export function ProfileForm({ profile }: { profile: Profile | null }) {
  const router = useRouter();
  const supabase = createClient();
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    name: profile?.name || "",
    city: profile?.city || "",
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
    const { error } = await supabase
      .from("profiles")
      .update({
        name: form.name || null,
        city: form.city || null,
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

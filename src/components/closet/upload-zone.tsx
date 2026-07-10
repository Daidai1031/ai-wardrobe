"use client";

import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Upload, Loader2, Check, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import Image from "next/image";

type Stage = "idle" | "uploading" | "removing-bg" | "classifying" | "done" | "error";

const STAGE_LABELS: Record<Stage, string> = {
  idle: "Drop a photo or tap to upload",
  uploading: "Uploading image…",
  "removing-bg": "Removing background…",
  classifying: "AI is analyzing your item…",
  done: "Done!",
  error: "Something went wrong",
};

export function UploadZone() {
  const [stage, setStage] = useState<Stage>("idle");
  const [preview, setPreview] = useState<string | null>(null);
  const [result, setResult] = useState<{ clean_url: string; category: string; subcategory: string; color: string } | null>(null);
  const router = useRouter();
  const supabase = createClient();

  const processFile = useCallback(async (file: File) => {
    try {
      // Preview
      setPreview(URL.createObjectURL(file));
      setStage("uploading");

      // Get user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not logged in");

      // Upload original to Supabase Storage
      const ext = file.name.split(".").pop() || "jpg";
      const storagePath = `${user.id}/${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("wardrobe")
        .upload(storagePath, file, { contentType: file.type });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from("wardrobe")
        .getPublicUrl(storagePath);

      // Call the AI pipeline
      setStage("removing-bg");

      const res = await fetch("/api/ai/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ originalUrl: publicUrl, storagePath }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Pipeline failed");
      }

      setStage("classifying");
      const data = await res.json();

      setResult({
        clean_url: data.item.clean_url,
        category: data.item.category,
        subcategory: data.item.subcategory,
        color: data.item.color,
      });
      setStage("done");
      toast.success(`Added: ${data.item.color} ${data.item.subcategory || data.item.category}`);

      // Refresh closet after a short delay
      setTimeout(() => {
        router.refresh();
        setStage("idle");
        setPreview(null);
        setResult(null);
      }, 2000);
    } catch (err) {
      console.error("Upload error:", err);
      setStage("error");
      toast.error(err instanceof Error ? err.message : "Upload failed");
      setTimeout(() => {
        setStage("idle");
        setPreview(null);
      }, 3000);
    }
  }, [supabase, router]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (files) => {
      if (files[0]) processFile(files[0]);
    },
    accept: { "image/*": [".jpg", ".jpeg", ".png", ".webp", ".heic"] },
    maxFiles: 1,
    disabled: stage !== "idle",
  });

  const isProcessing = stage !== "idle" && stage !== "done" && stage !== "error";

  return (
    <div
      {...getRootProps()}
      className={`relative border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all ${
        isDragActive
          ? "border-brand-400 bg-brand-50"
          : stage === "done"
          ? "border-green-300 bg-green-50"
          : stage === "error"
          ? "border-red-300 bg-red-50"
          : "border-surface-300 hover:border-surface-400 bg-white"
      }`}
    >
      <input {...getInputProps()} />

      {preview && (
        <div className="mb-4 flex justify-center">
          <div className="relative w-32 h-32 rounded-xl overflow-hidden bg-surface-100">
            <Image
              src={result?.clean_url || preview}
              alt="Preview"
              fill
              className="object-contain"
              unoptimized
            />
          </div>
        </div>
      )}

      <div className="flex flex-col items-center gap-2">
        {isProcessing ? (
          <Loader2 size={28} className="text-brand-500 animate-spin" />
        ) : stage === "done" ? (
          <Check size={28} className="text-green-600" />
        ) : stage === "error" ? (
          <AlertCircle size={28} className="text-red-500" />
        ) : (
          <Upload size={28} className="text-surface-400" />
        )}
        <p className="text-sm font-medium text-surface-600">
          {STAGE_LABELS[stage]}
        </p>
        {result && stage === "done" && (
          <p className="text-xs text-surface-500">
            {result.color} {result.subcategory || result.category}
          </p>
        )}
        {stage === "idle" && (
          <p className="text-xs text-surface-400 mt-1">
            Single item photo — flat-lay or hanging. JPG, PNG, WebP, HEIC.
          </p>
        )}
      </div>
    </div>
  );
}

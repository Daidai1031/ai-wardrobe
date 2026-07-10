"use client";

import Image from "next/image";
import Link from "next/link";
import type { WardrobeItem } from "@/types/database";
import { Heart, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface ItemCardProps {
  item: WardrobeItem;
  onToggleFavorite?: (id: string, current: boolean) => void;
  selecting?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
}

export function ItemCard({
  item,
  onToggleFavorite,
  selecting,
  selected,
  onToggleSelect,
}: ItemCardProps) {
  return (
    <Link
      href={`/closet/${item.id}`}
      onClick={(e) => {
        if (selecting) {
          e.preventDefault();
          onToggleSelect?.(item.id);
        }
      }}
      className={cn(
        "group relative bg-white rounded-xl border overflow-hidden hover:shadow-md transition-shadow",
        selected ? "border-brand-500 ring-2 ring-brand-500" : "border-surface-200"
      )}
    >
      {/* Image */}
      <div className="relative aspect-square bg-surface-50">
        <Image
          src={item.clean_url || item.original_url}
          alt={`${item.color || ""} ${item.subcategory || item.category}`}
          fill
          className="object-contain p-2"
          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
          unoptimized
        />

        {/* Select checkbox */}
        {selecting && (
          <div
            className={cn(
              "absolute top-2 left-2 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors",
              selected
                ? "bg-brand-600 border-brand-600"
                : "bg-white/80 backdrop-blur-sm border-surface-300"
            )}
          >
            {selected && <Check size={12} className="text-white" strokeWidth={3} />}
          </div>
        )}

        {/* Favorite button */}
        {!selecting && onToggleFavorite && (
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onToggleFavorite(item.id, item.favorite);
            }}
            className="absolute top-2 right-2 p-1.5 rounded-full bg-white/80 backdrop-blur-sm hover:bg-white transition-colors"
          >
            <Heart
              size={14}
              className={cn(
                "transition-colors",
                item.favorite ? "fill-red-500 text-red-500" : "text-surface-400"
              )}
            />
          </button>
        )}
      </div>

      {/* Meta */}
      <div className="p-2.5">
        <p className="text-xs font-medium text-surface-800 truncate">
          {item.subcategory || item.category}
        </p>
        <div className="flex items-center gap-1.5 mt-1">
          {item.color && (
            <span className="inline-block w-2.5 h-2.5 rounded-full border border-surface-200"
              style={{ backgroundColor: item.color.toLowerCase() }}
            />
          )}
          <span className="text-[11px] text-surface-500 capitalize truncate">
            {item.color}
            {item.brand ? ` · ${item.brand}` : ""}
          </span>
        </div>
      </div>
    </Link>
  );
}

"use client";

import Image from "next/image";
import Link from "next/link";
import type { WardrobeItem } from "@/types/database";
import { Heart } from "lucide-react";
import { cn } from "@/lib/utils";

interface ItemCardProps {
  item: WardrobeItem;
  onToggleFavorite?: (id: string, current: boolean) => void;
}

export function ItemCard({ item, onToggleFavorite }: ItemCardProps) {
  return (
    <Link
      href={`/closet/${item.id}`}
      className="group relative bg-white rounded-xl border border-surface-200 overflow-hidden hover:shadow-md transition-shadow"
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

        {/* Favorite button */}
        {onToggleFavorite && (
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

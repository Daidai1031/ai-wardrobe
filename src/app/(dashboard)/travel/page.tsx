import { Plane } from "lucide-react";

export default function TravelPage() {
  return (
    <div>
      <h1 className="text-xl font-semibold text-surface-900 mb-1">Travel Planner</h1>
      <p className="text-sm text-surface-500 mb-8">Plan outfits for your trips</p>

      <div className="text-center py-20 bg-white rounded-2xl border border-surface-200">
        <Plane size={32} className="mx-auto text-surface-300 mb-3" />
        <p className="text-surface-500 text-sm">
          Travel planning is coming in Phase 5.
        </p>
        <p className="text-surface-400 text-xs mt-1">
          Build your wardrobe first — then we can pack smartly for any trip.
        </p>
      </div>
    </div>
  );
}

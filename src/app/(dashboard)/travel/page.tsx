import { TripList } from "./trip-list";

export default function TravelPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-surface-900">Trips</h1>
        <p className="mt-1 text-sm text-surface-500">
          Every trip on your calendar in the next 30 days, found automatically. Open one to
          plan what you&apos;ll wear, then pack from it.
        </p>
      </div>
      <TripList />
    </div>
  );
}

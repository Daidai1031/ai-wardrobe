import { redirect } from "next/navigation";

// Closet analytics lives at the bottom of /profile now; this keeps old links working.
export default function AnalyticsRedirect() {
  redirect("/profile");
}

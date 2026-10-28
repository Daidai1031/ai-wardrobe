import { redirect } from "next/navigation";

// Closet analytics is a tab of /closet now; this keeps old links working.
export default function AnalyticsRedirect() {
  redirect("/closet?tab=analytics");
}

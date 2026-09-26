import { redirect } from "next/navigation";

// The AI Stylist is a tab on /outfits now; this keeps old links and bookmarks working.
export default function StylistRedirect() {
  redirect("/outfits?tab=stylist");
}

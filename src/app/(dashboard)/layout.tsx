import { Sidebar } from "@/components/layout/sidebar";
import { createServerSupabase } from "@/lib/supabase/server";
import { STYLIST_ROLE } from "@/lib/stylist/access";
import { readStylistReviewsForClient } from "@/lib/stylist/reviews";
import { readMessagesForClient } from "@/lib/stylist/messages";
import { StylistMailbox } from "@/components/stylist/stylist-mailbox";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Read straight from the session's own profile row rather than through
  // isStylist() — that helper uses the service role, which is more authority than
  // "does the signed-in user see a nav link" needs.
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let isStylist = false;
  // Defaults to true so an account with no roles array at all still gets the normal app
  // rather than an empty shell.
  let isClient = true;
  if (user) {
    const { data } = await supabase.from("profiles").select("roles").eq("id", user.id).maybeSingle();
    const roles = data?.roles ?? [];
    isStylist = roles.includes(STYLIST_ROLE);
    isClient = roles.length === 0 || roles.includes("client");
  }

  // Mounted here rather than on /home so the button is on every page. A layout survives
  // client-side navigation, so the mailbox keeps its open/read state from page to page; the
  // data is fresh on a full load or a router.refresh().
  const mailbox =
    user && isClient ? (
      <StylistMailbox
        reviews={await readStylistReviewsForClient(supabase, user.id)}
        messages={await readMessagesForClient(supabase, user.id)}
      />
    ) : null;

  return (
    <div className="dashboard-shell min-h-screen bg-surface-100">
      <Sidebar isStylist={isStylist} isClient={isClient} />
      {mailbox}
      <main className="lg:pl-56 pt-14 pb-24 lg:pt-0 lg:pb-0">
        <div className="max-w-6xl mx-auto p-4 lg:mx-0 lg:max-w-[1192px] lg:py-8 lg:pl-10 lg:pr-8">
          {children}
        </div>
      </main>
    </div>
  );
}

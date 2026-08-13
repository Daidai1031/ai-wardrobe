import { Sidebar } from "@/components/layout/sidebar";
import { createServerSupabase } from "@/lib/supabase/server";
import { STYLIST_ROLE } from "@/lib/stylist/access";

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

  return (
    <div className="min-h-screen bg-surface-50">
      <Sidebar isStylist={isStylist} isClient={isClient} />
      <main className="lg:pl-56 pt-14 lg:pt-0">
        <div className="max-w-6xl mx-auto p-4 lg:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}

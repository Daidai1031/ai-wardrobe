import Link from "next/link";
import { ArrowRight, ShieldCheck, Users } from "lucide-react";
import { createServerSupabase } from "@/lib/supabase/server";
import { isStylist, listAccessibleClients } from "@/lib/stylist/access";

export const dynamic = "force-dynamic";

/**
 * The stylist console's entry point (ROADMAP Phase 10-A). Lists every client whose
 * access window is currently open — D16's gate, not a client list we maintain: a
 * consultation ending sets `access_expires_at` 14 days out and the row simply drops
 * off this page when it lapses.
 */

function daysLeft(expiresAt: string) {
  const ms = new Date(expiresAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

export default async function ProPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  if (!(await isStylist(user.id))) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-surface-200 bg-white p-8 text-center">
        <ShieldCheck size={28} className="mx-auto mb-3 text-surface-300" />
        <h1 className="text-lg font-semibold text-surface-900">Stylist console</h1>
        <p className="mt-2 text-sm text-surface-500">
          This area is for our styling team. Looking for outfit help?{" "}
          <Link href="/stylist" className="font-medium text-brand-600 hover:underline">
            Open the AI Stylist
          </Link>
          .
        </p>
      </div>
    );
  }

  const clients = await listAccessibleClients(user.id);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-surface-900">Clients</h1>
        <p className="mt-1 text-sm text-surface-500">
          Clients who have an open access window. A window opens when a consultation is
          marked finished and closes automatically 14 days later.
        </p>
      </header>

      {clients.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-surface-200 bg-white p-10 text-center">
          <Users size={26} className="mx-auto mb-3 text-surface-300" />
          <p className="text-sm font-medium text-surface-700">No open windows right now</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-surface-400">
            Mark a consultation as finished in the CRM and the client will appear here.
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {clients.map((client) => {
            const remaining = daysLeft(client.accessExpiresAt);
            return (
              <li key={client.id}>
                <Link
                  href={`/pro/${client.id}`}
                  className="group flex items-center justify-between gap-4 rounded-2xl border border-surface-200 bg-white p-4 transition-all hover:-translate-y-0.5 hover:border-surface-300 hover:shadow-sm"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-surface-900">
                      {client.name || client.email || "Client"}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-surface-400">
                      {client.city || "No city set"}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <span className="rounded-full bg-surface-100 px-2 py-0.5 text-[10px] font-medium text-surface-500">
                        {remaining} {remaining === 1 ? "day" : "days"} left
                      </span>
                      <span
                        className={
                          client.shareOccasions
                            ? "rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-medium text-brand-700"
                            : "rounded-full bg-surface-100 px-2 py-0.5 text-[10px] font-medium text-surface-400"
                        }
                      >
                        {client.shareOccasions ? "Occasions shared" : "Occasions private"}
                      </span>
                    </div>
                  </div>
                  <ArrowRight
                    size={16}
                    className="shrink-0 text-surface-300 transition-colors group-hover:text-surface-600"
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

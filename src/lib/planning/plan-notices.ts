/**
 * Notices the planner wants the user to see but that don't belong on the page that
 * produced them — today, the rotation rules a generation couldn't satisfy. `/plan`
 * publishes them and the floating mailbox (mounted in the dashboard layout) lists them,
 * so the two never import each other.
 *
 * Browser-only and per tab: a notice lives for the session (sessionStorage) and is not
 * written to the database, because it describes one generation and goes stale the moment
 * the week is replanned.
 */

export interface PlanNotice {
  id: string;
  title: string;
  lines: string[];
  at: string;
}

const EVENT = "plan-notices-changed";
const STORAGE_KEY = "plan-notices";

export function readPlanNotices(): PlanNotice[] {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(notices: PlanNotice[]) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(notices));
  } catch {
    // Storage unavailable: the notice still reaches a mailbox that is already mounted.
  }
  window.dispatchEvent(new CustomEvent<PlanNotice[]>(EVENT, { detail: notices }));
}

/** One notice per `id`: a fresh generation replaces the previous one rather than stacking. */
export function publishPlanNotice(notice: Omit<PlanNotice, "at">) {
  const next = [
    { ...notice, at: new Date().toISOString() },
    ...readPlanNotices().filter((n) => n.id !== notice.id),
  ];
  write(next);
}

export function dismissPlanNotice(id: string) {
  write(readPlanNotices().filter((n) => n.id !== id));
}

export function subscribePlanNotices(listener: (notices: PlanNotice[]) => void) {
  const handler = (event: Event) => listener((event as CustomEvent<PlanNotice[]>).detail);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}

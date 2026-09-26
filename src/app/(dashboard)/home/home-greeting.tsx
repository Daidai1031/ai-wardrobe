"use client";

import { useEffect, useState } from "react";
import { SPLASH_COOKIE } from "./splash-cookie";

const SPLASH_MS = 2600;

export function greetingFor(hour: number) {
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 18) return "Good afternoon";
  return "Good evening";
}

/**
 * Phone only: the greeting that opens a session, full screen, then fades away on its own
 * (or on a tap). The server decides whether to render it at all, from `SPLASH_COOKIE`, so
 * there is nothing to flash or mismatch; the wording waits for the browser because only
 * the browser knows the local time. Skipped entirely under reduced motion.
 */
export function HomeSplash({ firstName }: { firstName?: string }) {
  const [greeting, setGreeting] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    setGreeting(greetingFor(new Date().getHours()));
    if (window.innerWidth < 1024) {
      document.cookie = `${SPLASH_COOKIE}=1; path=/; SameSite=Lax`;
    }
    const timer = window.setTimeout(() => setDone(true), SPLASH_MS);
    return () => window.clearTimeout(timer);
  }, []);

  if (done) return null;

  return (
    <div
      aria-hidden
      onClick={() => setDone(true)}
      className="home-splash fixed inset-0 z-[70] flex items-center justify-center bg-surface-200 px-8 text-center lg:hidden motion-reduce:hidden"
    >
      {greeting && (
        <p className="home-splash-text font-serif text-[42px] leading-[1.25] text-ink">
          {greeting}
          {firstName ? (
            <>
              ,<br />
              {firstName}
            </>
          ) : null}
        </p>
      )}
    </div>
  );
}

/** Phone only: the same greeting, small, as the first line of the page. */
export function PhoneGreeting({ firstName }: { firstName?: string }) {
  const [greeting, setGreeting] = useState("Hello");
  useEffect(() => setGreeting(greetingFor(new Date().getHours())), []);

  return (
    <h1 className="font-serif text-[15px] leading-5 text-ink lg:hidden">
      {greeting}
      {firstName ? `, ${firstName}` : ""}
    </h1>
  );
}

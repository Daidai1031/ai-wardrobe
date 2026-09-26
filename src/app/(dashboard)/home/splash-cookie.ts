/**
 * Set once the phone splash has played, so it opens a session rather than every visit to
 * /home. Its own module for the reason `weather-slot.ts` is: `page.tsx` is a Server
 * Component, and a constant exported from a "use client" file would reach it as a client
 * reference, not a string.
 */
export const SPLASH_COOKIE = "home-splash";

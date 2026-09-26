/**
 * The element under the greeting that `page.tsx` renders for the forecast to land in.
 * Its own module because `page.tsx` is a Server Component: a constant exported from
 * `daily-recommendation.tsx` ("use client") would reach it as a client reference, not a string.
 */
export const HOME_WEATHER_SLOT_ID = "home-weather-slot";

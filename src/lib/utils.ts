import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * The design system's own font sizes (`tailwind.config.ts` -> `fontSize`). tailwind-merge only
 * knows Tailwind's stock `text-xs` ... `text-9xl`, so it read `text-button` as a text COLOUR and,
 * whenever a real colour class (`text-ink`, `text-ink-inverse`) followed in the same `cn()`,
 * silently dropped the size: buttons rendered at the inherited 16px regular instead of the
 * token's 14px semibold. Registering them as font sizes lets a size and a colour coexist and
 * lets a later size override an earlier one. Keep this list in step with the config.
 */
const CUSTOM_FONT_SIZES = [
  "display",
  "heading",
  "subheading",
  "body",
  "body-small",
  "label",
  "button",
];

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: CUSTOM_FONT_SIZES }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

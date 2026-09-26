// Merge this into the existing `theme.extend` block in tailwind.config.ts.
// Do not replace the whole config — extend it, so any existing Tailwind
// defaults/plugins the project already relies on keep working.

const designTokens = {
  colors: {
    "surface-100": "#FFFFFF", // page background — pure white
    "surface-200": "#F5F2F0", // card/panel background only, never the page bg
    ink: "#0A0A0A",
    "ink-muted": "#707070",
    "ink-inverse": "#F5F2F0",
    accent: "#D96826", // reserved for the single primary action per screen
    "accent-soft": "#F7EEE8", // large low-emphasis fills ONLY, never small tags
    border: "#DBD8D6",
  },

  fontFamily: {
    serif: ["var(--font-serif)", "Georgia", "serif"], // headline moments only
    sans: ["var(--font-sans)", "-apple-system", "Segoe UI", "sans-serif"],
  },

  fontSize: {
    display: ["28px", { lineHeight: "34px", fontWeight: "600", letterSpacing: "0.005em" }],
    heading: ["20px", { lineHeight: "26px", fontWeight: "600", letterSpacing: "0.005em" }],
    subheading: ["15px", { lineHeight: "20px", fontWeight: "600" }], // Semibold, confirmed — not Bold
    body: ["12px", { lineHeight: "19px", fontWeight: "400" }],
    "body-small": ["11px", { lineHeight: "18px", fontWeight: "400" }],
    label: ["10.5px", { lineHeight: "14px", fontWeight: "700", letterSpacing: "0.04em" }],
    button: ["13px", { lineHeight: "19px", fontWeight: "600" }],
  },

  spacing: {
    "space-1": "4px",
    "space-2": "8px", // load-bearing for the card radius-nesting formula — see design-tokens.md
    "space-3": "14px",
    "space-4": "21px",
    "space-5": "34px",
  },

  borderRadius: {
    none: "0px",
    sm: "8px", // nested image inside a card — derived (radius-md − space-2)
    md: "16px", // cards, the canvas frame
    lg: "24px", // modals/sheets (reserved, unused so far)
    full: "9999px", // circular elements AND primary tap targets only — see design-tokens.md
  },
};

export default designTokens;

/* Usage examples once merged:
   bg-surface-100 text-ink              → page background + primary text
   bg-surface-200 rounded-md shadow-...  → a card
   text-display font-serif               → the greeting
   rounded-full bg-accent text-ink-inverse → the Confirm CTA
   rounded-full border border-ink text-ink → the "Saved" pill (outline)
*/

import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#faf5f0",
          100: "#f3e8db",
          200: "#e6cdb3",
          300: "#d4aa82",
          400: "#c48a58",
          500: "#b87340",
          600: "#a45e34",
          700: "#88492c",
          800: "#6f3c29",
          900: "#5b3325",
          950: "#311912",
        },
        surface: {
          0: "#ffffff",
          50: "#fafaf9",
          100: "#f5f5f4",
          200: "#e7e5e4",
          300: "#d6d3d1",
          400: "#a8a29e",
          500: "#78716c",
          600: "#57534e",
          700: "#44403c",
          800: "#292524",
          900: "#1c1917",
        },
        // Design-system tokens (docs/design-tokens.md). "surface-100"/"surface-200"
        // deliberately override the two matching shades above — the legacy
        // surface-{0,50,300-900} gray scale is otherwise untouched.
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
        sans: ["var(--font-body)", "Georgia", "serif"], // EB Garamond — kept under the `sans` key so every default and `font-sans` call site follows without edits
        // Alex Brush — every heading. `serif` and `display` are kept as aliases so the
        // existing font-serif / font-display call sites need no edits.
        heading: ["var(--font-heading)", "cursive"],
        serif: ["var(--font-heading)", "cursive"],
        display: ["var(--font-heading)", "cursive"],
      },
      fontSize: {
        display: ["30px", { lineHeight: "36px", fontWeight: "600", letterSpacing: "0.05em" }],
        heading: ["22px", { lineHeight: "28px", fontWeight: "600", letterSpacing: "0.05em" }],
        subheading: ["16px", { lineHeight: "22px", fontWeight: "600" }], // Semibold, confirmed — not Bold
        body: ["14px", { lineHeight: "21px", fontWeight: "400" }],
        "body-small": ["12px", { lineHeight: "19px", fontWeight: "400" }],
        label: ["11.5px", { lineHeight: "15px", fontWeight: "700", letterSpacing: "0.04em" }],
        button: ["14px", { lineHeight: "20px", fontWeight: "600" }],
        // The stock scale, one step up: the un-restyled pages still use these, and would
        // otherwise sit a size below the tokens above.
        xs: ["13px", { lineHeight: "18px" }],
        sm: ["15px", { lineHeight: "21px" }],
        base: ["17px", { lineHeight: "25px" }],
        lg: ["19px", { lineHeight: "27px" }],
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
    },
  },
  plugins: [],
};

export default config;

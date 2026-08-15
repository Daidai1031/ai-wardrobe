import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Unit tests for the deterministic core only — the modules that decide things in
 * TypeScript rather than by asking a model (ROADMAP D8): plan rules, trip
 * detection, occasion segmentation and local-day bucketing.
 *
 * Nothing here touches the network, Supabase, or an API key, and nothing here
 * renders a component. Those need a live account and a browser, which is what the
 * verification status tables in `checklist.md` track.
 */
export default defineConfig({
  resolve: {
    // Mirrors tsconfig.json's `"@/*": ["./src/*"]`. Set here rather than via a
    // plugin so the test setup needs no dependency beyond vitest itself.
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // `src/lib/calendar/classify-events.ts` constructs an Anthropic client at
    // module scope, and the SDK throws on an empty key at construction time.
    // `detect-trips.ts` imports one pure helper from that file, so importing it
    // pulls the client in. A dummy value keeps the import side-effect-free; no
    // test in this suite ever issues a request.
    env: {
      ANTHROPIC_API_KEY: "test-key-not-used",
    },
  },
});

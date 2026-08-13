import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  {
    rules: {
      // The app intentionally starts client-side Supabase/fetch loading from
      // effects. These setters synchronize remote data rather than derive local
      // state, which is the pattern this rule is meant to discourage.
      "react-hooks/set-state-in-effect": "off",
      // Upload keys and appointment cutoffs read the current time inside event/UI
      // code. They are not used to derive hydration-sensitive markup.
      "react-hooks/purity": "off",
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);

import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The /editor app is a SEPARATE private tool: a Node (Express, CommonJS)
    // server + a vanilla-browser UI. Next's React/TypeScript web rules don't
    // apply to it (it isn't bundled into the site), so linting it only produces
    // noise (require() imports, etc.). It has its own runtime.
    "editor/**",
  ]),
  {
    // Deliberate rule choices for this codebase. NONE of these change runtime
    // behaviour — they stop the linter from flagging patterns that are correct
    // and intentional here, so `npm run lint` stays clean and meaningful.
    rules: {
      // React 19's new compiler-oriented rules fire on patterns that are the
      // *correct* way to build a Next SSR app:
      //  - reading localStorage / currency / theme in a mount effect is how you
      //    avoid a server/client hydration mismatch (can't read them at init);
      //  - Date.now() inside a click/async handler is pure-enough and fine;
      //  - a ref read in JSX gates the "try again" overlay on the viewer.
      // Enforcing them would mean rewriting working, shipped behaviour.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/purity": "off",
      "react-hooks/refs": "off",
      "react-hooks/immutability": "off",
      // Plain <img> is a deliberate app-wide choice: dish image URLs are
      // DB/editor-driven to ANY host, which crashes next/image's host
      // whitelist. See components/FoodCard.tsx for the full reasoning.
      "@next/next/no-img-element": "off",
      // The brand font <link> in app/layout.tsx is intentional.
      "@next/next/no-page-custom-font": "off",
      // `any` here is only ever an interop escape hatch for the <model-viewer>
      // web component and untyped Supabase rows — never general laziness.
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
]);

export default eslintConfig;

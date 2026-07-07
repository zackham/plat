// Minimal lint: the import boundary, at editor speed. The same rules are
// enforced exhaustively (string-level, incl. raw fetch/API-path scans) by
// src/__tests__/boundary.test.ts — this config exists so violations surface
// in the editor before the test run does.
import tseslint from "typescript-eslint"

export default tseslint.config(
  { ignores: ["node_modules", "dist", "examples"] },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: { parser: tseslint.parser },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/*"],
              message:
                "plat is host-agnostic — no app-alias imports. Data arrives via the PlatHost adapter (host.ts).",
            },
            {
              group: ["../../*"],
              message:
                "plat must not reach outside its own source tree — inject the dependency through PlatHost instead.",
            },
            {
              group: ["sonner"],
              message: "Notifications are a host capability (host.notify).",
            },
            {
              group: ["@tanstack/*"],
              message:
                "Data fetching/caching is the host's concern (PlatHost + measureData.ts).",
            },
          ],
        },
      ],
    },
  },
)

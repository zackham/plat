// Import-boundary guard: features/canvas is an embeddable library and must
// never reach into the host application. Every data need goes through the
// PlatHost adapter (host.ts). If this test fails, a vita-specific dependency
// leaked into the library — move it behind the adapter or into
// features/canvases (vita's host layer) instead.

import { describe, expect, it } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const LIB_ROOT = join(__dirname, "..")

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name === "__tests__") continue
      out.push(...sourceFiles(p))
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(p)
    }
  }
  return out
}

interface Rule {
  name: string
  pattern: RegExp
  /** file (relative to the lib root) → allowed occurrence, if any */
  allow?: (file: string, line: string) => boolean
}

const RULES: Rule[] = [
  { name: "app-alias import (@/…)", pattern: /from\s+["']@\// },
  { name: "reach into sibling feature (../…features or ../canvases)", pattern: /from\s+["']\.\.\/\.\./ },
  { name: "sonner (host owns notifications via host.notify)", pattern: /["']sonner["']/ },
  { name: "react-query (host owns data fetching)", pattern: /@tanstack\/react-query/ },
  { name: "hardcoded API path", pattern: /["'`]\/api\// },
  {
    name: "direct fetch (data access goes through PlatHost)",
    pattern: /\bfetch\s*\(/,
    // export.ts re-fetches an image the browser is already rendering, by the
    // src the host itself supplied — host-agnostic by construction.
    allow: (file, line) => file === "export.ts" && line.includes("fetch(n.src)"),
  },
  {
    // All chrome styling lives in plat.css behind --plat-* tokens; utility
    // classes from a host CSS framework must never reappear in the library.
    name: "tailwind-style utility classes (styles live in plat.css)",
    pattern: /className=.*(?:slate-|indigo-|rose-|emerald-|amber-|bg-white|text-white|flex-1 )/,
  },
]

describe("library import boundary", () => {
  const files = sourceFiles(LIB_ROOT)

  it("finds the library sources", () => {
    expect(files.length).toBeGreaterThan(10)
  })

  for (const rule of RULES) {
    it(`no ${rule.name}`, () => {
      const violations: string[] = []
      for (const f of files) {
        const rel = relative(LIB_ROOT, f)
        const lines = readFileSync(f, "utf8").split("\n")
        lines.forEach((line, i) => {
          if (rule.pattern.test(line) && !rule.allow?.(rel, line)) {
            violations.push(`${rel}:${i + 1}  ${line.trim()}`)
          }
        })
      }
      expect(violations, violations.join("\n")).toEqual([])
    })
  }
})

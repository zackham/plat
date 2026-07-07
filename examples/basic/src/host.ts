// The whole host, ~100 lines: docs in localStorage (with the revision
// protocol), assets as data-URLs, and fake measures that "recompute" on
// refresh. Everything plat needs from an app, in miniature.

import { PlatSaveConflictError } from "plat"
import type { MeasureData, PlatDoc, PlatHost } from "plat"
import { seedDoc } from "./seed"

const DOC_KEY = "plat-example:doc"

const FAKE_MEASURES: Record<string, { name: string; compute: () => Record<string, unknown> }> = {
  m_signups: {
    name: "signup conversion",
    compute: () => ({
      value: 0.2 + Math.random() * 0.15,
      label: "visit → account, last 30d",
      note: "Fake data — every refresh draws a new number.",
    }),
  },
  m_active: {
    name: "weekly actives",
    compute: () => ({
      value: 12000 + Math.round(Math.random() * 3000),
      label: "unique users / wk",
      link: { url: "https://github.com/zackham/plat", label: "source" },
    }),
  },
  m_notes: {
    name: "readout",
    compute: () => ({
      display: "text",
      text: "Measures can render text too.\nHosts decide what computes them:\nSQL, an API, a script — anything.",
    }),
  },
}

const latest = new Map<string, MeasureData["latest"]>()

function measureData(id: string): MeasureData {
  const def = FAKE_MEASURES[id]
  if (!def) throw new Error(`unknown measure: ${id}`)
  if (!latest.has(id)) {
    latest.set(id, {
      result: def.compute(),
      error: null,
      refreshed_at: new Date().toISOString(),
    })
  }
  return { id, name: def.name, latest: latest.get(id)! }
}

function loadStored(): PlatDoc | null {
  const raw = localStorage.getItem(DOC_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as PlatDoc
  } catch {
    return null
  }
}

export function makeLocalStorageHost(): PlatHost {
  return {
    async loadDoc() {
      return loadStored() ?? seedDoc()
    },

    // Revision protocol in ~10 lines: reject a stale base, store under +1.
    async saveDoc(doc) {
      const stored = loadStored()
      const storedRev = stored?.revision ?? 0
      if (doc.revision != null && doc.revision !== storedRev) {
        throw new PlatSaveConflictError()
      }
      const revision = storedRev + 1
      localStorage.setItem(DOC_KEY, JSON.stringify({ ...doc, revision }))
      return { revision }
    },

    // Data-URLs persist inside the doc itself — fine for a demo.
    uploadAsset: (blob) =>
      new Promise((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve({ src: String(r.result) })
        r.onerror = () => reject(new Error("could not read file"))
        r.readAsDataURL(blob)
      }),

    measures: {
      get: async (id) => measureData(id),
      refresh: async (id) => {
        latest.delete(id)
        return measureData(id)
      },
      list: async () =>
        Object.entries(FAKE_MEASURES).map(([id, d]) => ({ id, name: d.name })),
    },

    notify: (kind, message) => console.log(`[${kind}] ${message}`),
  }
}

export function resetDoc(): void {
  localStorage.removeItem(DOC_KEY)
}

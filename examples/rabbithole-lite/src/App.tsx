import { useCallback, useMemo, useRef, useState } from "react"
import { Plat, settleDoc } from "plat"
import type { PlatApi, PlatDoc, PlatHost } from "plat"
import "plat/plat.css"
import "./rabbithole.css"
import { documentNodeType } from "./DocumentNode"
import { BranchContext, makeBranch, type BranchFn } from "./branching"

const DOC_KEY = "rabbithole-lite:doc"

const ROOT_MD = `# Down the rabbit hole

This canvas is **plat** hosting a node type it has never heard of:
\`rabbithole.document\` — rendered markdown, scrollable, selectable, streaming.

**Select any text in this card** and a toolbar appears: pick a lens
(Explain · ELI5 · Example · Go deeper) or type a question. The answer opens as
a linked child card and streams in. Recurse as deep as you like.

Everything else is stock plat: drag cards, pan/zoom, undo (⌘Z) — undoing a
streamed answer removes it in one step. The doc persists to localStorage;
Reset starts over.`

function seed(): PlatDoc {
  return {
    format: "plat",
    version: 1,
    nodes: settleDoc([
      {
        id: "root",
        type: "rabbithole.document",
        x: 120,
        y: 120,
        w: 480,
        h: 200,
        index: "",
        props: { title: "Start here", markdown: ROOT_MD, status: "done" },
      },
    ]),
  }
}

function makeHost(): PlatHost {
  return {
    async loadDoc() {
      const raw = localStorage.getItem(DOC_KEY)
      if (raw) {
        try {
          return JSON.parse(raw) as PlatDoc
        } catch {
          /* fall through to seed */
        }
      }
      return seed()
    },
    async saveDoc(doc) {
      const stored = localStorage.getItem(DOC_KEY)
      const storedRev = stored ? ((JSON.parse(stored) as PlatDoc).revision ?? 0) : 0
      const revision = storedRev + 1
      localStorage.setItem(DOC_KEY, JSON.stringify({ ...doc, revision }))
      return { revision }
    },
  }
}

export function App() {
  const [dark, setDark] = useState(false)
  const [epoch, setEpoch] = useState(0)
  const host = useMemo(() => makeHost(), [])
  const branchRef = useRef<BranchFn | null>(null)

  const onReady = useCallback((api: PlatApi) => {
    branchRef.current = makeBranch(api)
  }, [])

  // stable context value delegating to the latest api-bound branch fn
  const branch = useCallback<BranchFn>((...args) => branchRef.current?.(...args), [])

  return (
    <BranchContext.Provider value={branch}>
      <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        <header className={`rh-header${dark ? " rh-header--dark" : ""}`}>
          <strong>rabbithole-lite</strong>
          <span className="rh-header__sub">
            select text in a card → branch → the answer streams in
          </span>
          <span style={{ flex: 1 }} />
          <label>
            <input type="checkbox" checked={dark} onChange={(e) => setDark(e.target.checked)} />{" "}
            dark
          </label>
          <button
            type="button"
            onClick={() => {
              localStorage.removeItem(DOC_KEY)
              setEpoch((n) => n + 1)
            }}
          >
            Reset
          </button>
        </header>
        <Plat
          key={epoch}
          host={host}
          nodeTypes={[documentNodeType]}
          theme={dark ? "dark" : "light"}
          onReady={onReady}
        />
      </div>
    </BranchContext.Provider>
  )
}

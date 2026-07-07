// The whole point of this example: a rich, interactive content node the plat
// engine knows nothing about. Rendered markdown, internal scrolling, text
// selection INSIDE the node, a selection toolbar — all inside a draggable,
// zoomable, undoable canvas node. ~150 lines.

import { useContext, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { marked } from "marked"
import { definePlatNodeType, platInteractive } from "plat"
import type { PlatNodeRenderProps } from "plat"
import { BranchContext, LENSES } from "./branching"

export interface DocProps {
  title: string
  markdown: string
  status: "streaming" | "done"
  /** the selected text this document branched from, if any */
  origin?: string
}

interface AskState {
  x: number
  y: number
  text: string
}

function DocumentCard({ node, readOnly }: PlatNodeRenderProps) {
  const props = (node as { props: Record<string, unknown> }).props as unknown as DocProps
  const branch = useContext(BranchContext)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const [ask, setAsk] = useState<AskState | null>(null)
  const [question, setQuestion] = useState("")

  // Selection → toolbar. mouseup inside the body: if a non-collapsed selection
  // lives within this card, park the ask-toolbar under it (portal — fixed
  // positioning can't be trusted inside the canvas's CSS transform).
  const onMouseUp = () => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !bodyRef.current) return setAsk(null)
    const text = sel.toString().trim()
    if (!text || !bodyRef.current.contains(sel.anchorNode)) return setAsk(null)
    const rect = sel.getRangeAt(0).getBoundingClientRect()
    setAsk({ x: rect.left + rect.width / 2, y: rect.bottom + 8, text })
  }

  useEffect(() => {
    if (!ask) return
    const clear = (e: PointerEvent) => {
      if ((e.target as Element | null)?.closest?.(".rh-ask")) return
      setAsk(null)
    }
    window.addEventListener("pointerdown", clear, true)
    return () => window.removeEventListener("pointerdown", clear, true)
  }, [ask])

  const fire = (lens: string | null) => {
    if (!ask) return
    branch?.(node.id, ask.text, lens, lens ? undefined : question)
    setAsk(null)
    setQuestion("")
  }

  return (
    <div className={`rh-card${props.status === "streaming" ? " rh-card--streaming" : ""}`}>
      <div className="rh-card__head">
        <span className="rh-card__title">{props.title}</span>
        {props.status === "streaming" && <span className="rh-card__dot" />}
      </div>
      {props.origin && <div className="rh-card__origin">“{props.origin}”</div>}
      <div
        {...platInteractive}
        ref={bodyRef}
        className="rh-card__body"
        onMouseUp={readOnly ? undefined : onMouseUp}
        // markdown from our own fake answerer — trusted content
        dangerouslySetInnerHTML={{ __html: marked.parse(props.markdown || "…") as string }}
      />
      {ask &&
        createPortal(
          <div className="rh-ask" style={{ left: ask.x, top: ask.y }}>
            <div className="rh-ask__lenses">
              {LENSES.map((l) => (
                <button key={l} type="button" onClick={() => fire(l)}>
                  {l}
                </button>
              ))}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (question.trim()) fire(null)
              }}
            >
              <input
                autoFocus
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="or ask anything…"
              />
            </form>
          </div>,
          document.body,
        )}
    </div>
  )
}

export const documentNodeType = definePlatNodeType({
  type: "rabbithole.document",
  render: DocumentCard,
  defaultProps: { title: "Untitled", markdown: "", status: "done" } satisfies Record<
    string,
    unknown
  >,
  defaultSize: { w: 440, h: 200 },
  behaviors: { autoHeight: true, minSize: 240 },
})

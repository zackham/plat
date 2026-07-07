import { useState } from "react"
import { RefreshCw, AlertCircle, Minus, Plus, Info } from "lucide-react"
import { useMeasureData, useMeasureStore } from "../measureData"
import { platInteractive } from "../nodeTypes"
import { formatValue, pickText, pickValue } from "../measureFormat"
import { useStore } from "../store"
import type { AnyNode, MeasureNode } from "../types"

export function MeasureContent({
  node: rawNode,
  readOnly,
}: {
  node: AnyNode
  readOnly: boolean
}) {
  const node = rawNode as MeasureNode
  const store = useStore()
  const measures = useMeasureStore()
  const m = useMeasureData(node.measureId)

  const latest = m.data?.latest
  const stale = !latest?.refreshed_at
  const fontScale = node.fontScale ?? 1

  const setFontScale = (next: number) => {
    const clamped = Math.min(3, Math.max(0.6, Math.round(next * 100) / 100))
    store.commit(() => store.replaceNode({ ...node, fontScale: clamped }))
  }

  const result = latest?.result as Record<string, unknown> | null | undefined
  const isText = result?.["display"] === "text"
  const linkObj =
    result && typeof result["link"] === "object" && result["link"]
      ? (result["link"] as { url: string; label?: string })
      : null
  const note =
    typeof result?.["note"] === "string" ? (result["note"] as string) : null

  const [showNote, setShowNote] = useState(false)

  return (
    <div className="plat-measure">
      <div className="plat-measure__inner">
        <div className="plat-measure__head">
          <div className="plat-measure__title">
            <span className="plat-measure__dot" />
            <span>{m.data?.name ?? "…"}</span>
          </div>
          {!readOnly && (
            <div className="plat-measure__controls" {...platInteractive}>
              <button
                type="button"
                className="plat-measure__ctl"
                disabled={fontScale <= 0.6}
                title="Smaller text"
                onClick={() => setFontScale(fontScale - 0.15)}
              >
                <Minus size={12} />
              </button>
              <button
                type="button"
                className="plat-measure__ctl"
                disabled={fontScale >= 3}
                title="Larger text"
                onClick={() => setFontScale(fontScale + 0.15)}
              >
                <Plus size={12} />
              </button>
              {measures.canRefresh && (
                <button
                  type="button"
                  className="plat-measure__ctl"
                  disabled={m.refreshing}
                  title="Refresh measure"
                  onClick={() => void measures.refresh(node.measureId)}
                >
                  <RefreshCw size={12} className={m.refreshing ? "plat-spin" : ""} />
                </button>
              )}
            </div>
          )}
        </div>

        <div className={`plat-measure__body${isText ? "" : " plat-measure__body--value"}`}>
          {latest?.error || m.error ? (
            <div className="plat-measure__error">
              <AlertCircle size={14} />
              <span>{latest?.error ? "script error" : m.error}</span>
            </div>
          ) : isText ? (
            <div
              className="plat-measure__text"
              style={{ fontSize: 13 * fontScale, lineHeight: 1.5 }}
            >
              {pickText(result) ?? (stale ? "never refreshed" : "no value")}
            </div>
          ) : pickValue(result) === undefined ? (
            <div className="plat-measure__empty">
              {stale ? "never refreshed" : "no value"}
            </div>
          ) : (
            <div
              className="plat-measure__value"
              style={{ fontSize: 30 * fontScale }}
            >
              {formatValue(pickValue(result))}
            </div>
          )}
        </div>

        <div className="plat-measure__foot">
          <span className="plat-measure__label">
            {!isText && typeof result?.["label"] === "string" ? (result["label"] as string) : ""}
          </span>
          <div className="plat-measure__foot-actions" {...platInteractive}>
            {note ? (
              <button
                type="button"
                onClick={() => setShowNote((v) => !v)}
                title="details"
                className={`plat-measure__note-btn${showNote ? " plat-measure__note-btn--open" : ""}`}
              >
                <Info size={11} /> details
              </button>
            ) : null}
            {linkObj ? (
              <a
                href={linkObj.url}
                target="_blank"
                rel="noopener noreferrer"
                title={linkObj.url}
                className="plat-measure__link"
              >
                {linkObj.label ?? "source"} ↗
              </a>
            ) : null}
          </div>
        </div>
      </div>
      {note && showNote ? (
        <div
          {...platInteractive}
          onClick={() => setShowNote(false)}
          className="plat-measure__note"
          title="click to close"
        >
          {note}
        </div>
      ) : null}
    </div>
  )
}

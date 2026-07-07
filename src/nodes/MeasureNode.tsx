import { useState } from "react"
import { RefreshCw, AlertCircle, Minus, Plus, Info } from "lucide-react"
import { useMeasureData, useMeasureStore } from "../measureData"
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

  const stop = (e: React.PointerEvent) => e.stopPropagation()
  const [showNote, setShowNote] = useState(false)

  return (
    <div className="relative w-full h-full bg-gradient-to-br from-indigo-50 to-white border border-indigo-200 ring-1 ring-indigo-100 rounded-lg shadow-sm overflow-hidden flex flex-col">
      <div className="p-3 flex flex-col gap-1 h-full">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 min-w-0 text-[10px] uppercase tracking-wide text-indigo-400">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0" />
            <span className="truncate">{m.data?.name ?? "…"}</span>
          </div>
          {!readOnly && (
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                className="text-slate-400 hover:text-slate-700 disabled:opacity-30"
                disabled={fontScale <= 0.6}
                title="Smaller text"
                onPointerDown={stop}
                onClick={(e) => {
                  e.stopPropagation()
                  setFontScale(fontScale - 0.15)
                }}
              >
                <Minus size={12} />
              </button>
              <button
                type="button"
                className="text-slate-400 hover:text-slate-700 disabled:opacity-30"
                disabled={fontScale >= 3}
                title="Larger text"
                onPointerDown={stop}
                onClick={(e) => {
                  e.stopPropagation()
                  setFontScale(fontScale + 0.15)
                }}
              >
                <Plus size={12} />
              </button>
              {measures.canRefresh && (
                <button
                  type="button"
                  className="text-slate-400 hover:text-slate-700 disabled:opacity-50"
                  disabled={m.refreshing}
                  title="Refresh measure"
                  onPointerDown={stop}
                  onClick={(e) => {
                    e.stopPropagation()
                    void measures.refresh(node.measureId)
                  }}
                >
                  <RefreshCw size={12} className={m.refreshing ? "animate-spin" : ""} />
                </button>
              )}
            </div>
          )}
        </div>

        <div className={`flex-1 flex min-h-0 ${isText ? "" : "items-center justify-center"}`}>
          {latest?.error || m.error ? (
            <div className="flex items-center gap-2 text-rose-600 text-xs">
              <AlertCircle size={14} />
              <span className="truncate">{latest?.error ? "script error" : m.error}</span>
            </div>
          ) : isText ? (
            <div
              className="flex-1 overflow-hidden whitespace-pre-line break-words text-left text-slate-800"
              style={{ fontSize: 13 * fontScale, lineHeight: 1.5 }}
            >
              {pickText(result) ?? (stale ? "never refreshed" : "no value")}
            </div>
          ) : pickValue(result) === undefined ? (
            <div className="text-slate-400 text-xs">
              {stale ? "never refreshed" : "no value"}
            </div>
          ) : (
            <div
              className="font-semibold text-slate-900 tabular-nums truncate"
              style={{ fontSize: 30 * fontScale }}
            >
              {formatValue(pickValue(result))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 text-[10px] text-slate-400">
          <span className="truncate">
            {!isText && typeof result?.["label"] === "string" ? (result["label"] as string) : ""}
          </span>
          <div className="flex items-center gap-2 shrink-0">
            {note ? (
              <button
                type="button"
                onPointerDown={stop}
                onClick={(e) => {
                  e.stopPropagation()
                  setShowNote((v) => !v)
                }}
                title="details"
                className={`inline-flex items-center gap-0.5 ${showNote ? "text-indigo-600" : "text-slate-400"} hover:text-indigo-600 font-medium`}
                style={{ pointerEvents: "auto" }}
              >
                <Info size={11} /> details
              </button>
            ) : null}
            {linkObj ? (
              <a
                href={linkObj.url}
                target="_blank"
                rel="noopener noreferrer"
                onPointerDown={stop}
                onClick={(e) => e.stopPropagation()}
                title={linkObj.url}
                className="inline-flex items-center gap-0.5 text-indigo-600 hover:text-indigo-800 hover:underline font-semibold"
                style={{ pointerEvents: "auto" }}
              >
                {linkObj.label ?? "source"} ↗
              </a>
            ) : null}
          </div>
        </div>
      </div>
      {note && showNote ? (
        <div
          onPointerDown={stop}
          onClick={(e) => {
            e.stopPropagation()
            setShowNote(false)
          }}
          className="absolute inset-1 z-10 bg-white/95 border border-indigo-200 rounded-md shadow-lg p-2 overflow-auto text-left text-[11px] leading-snug text-slate-600 whitespace-pre-line cursor-pointer"
          style={{ pointerEvents: "auto" }}
          title="click to close"
        >
          {note}
        </div>
      ) : null}
    </div>
  )
}

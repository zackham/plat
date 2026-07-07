import { useEffect, useState } from "react"
import {
  MousePointer2,
  Hand,
  MoveUpRight,
  Type,
  Frame,
  ImagePlus,
  Gauge,
  Sparkles,
} from "lucide-react"
import { usePlatHost } from "../host"
import type { MeasureSummary } from "../host"
import type { ToolMode } from "../types"

interface Props {
  tool: ToolMode
  onTool: (t: ToolMode) => void
  /** null ⇒ host can't store assets; the image button is hidden. */
  onInsertImage: (() => void) | null
  onInsertMeasure: (measureId: string) => void
  /** Host-specific "create a new measure" flow. null ⇒ no such entry. */
  onNewMeasure: (() => void) | null
  newMeasureLabel?: string
}

const TOOLS: { id: ToolMode; icon: typeof Hand; title: string }[] = [
  { id: "select", icon: MousePointer2, title: "Select (V)" },
  { id: "hand", icon: Hand, title: "Hand (H)" },
  { id: "arrow", icon: MoveUpRight, title: "Arrow (A)" },
  { id: "text", icon: Type, title: "Text (T)" },
  { id: "frame", icon: Frame, title: "Frame (F)" },
]

export function BottomToolbar({
  tool,
  onTool,
  onInsertImage,
  onInsertMeasure,
  onNewMeasure,
  newMeasureLabel = "New measure…",
}: Props) {
  const host = usePlatHost()
  const canPick = !!host.measures?.list
  const [measureOpen, setMeasureOpen] = useState(false)
  const [items, setItems] = useState<MeasureSummary[] | null>(null)

  const toggleMeasureMenu = () => {
    setMeasureOpen((o) => !o)
    setItems(null) // clear the stale list; the effect below refetches on open
  }

  useEffect(() => {
    if (!measureOpen || !host.measures?.list) return
    let cancelled = false
    host.measures
      .list()
      .then((ms) => {
        if (!cancelled) setItems(ms)
      })
      .catch(() => {
        if (!cancelled) setItems([])
      })
    return () => {
      cancelled = true
    }
  }, [measureOpen, host])

  return (
    <div className="absolute bottom-3 left-0 right-0 flex justify-center pointer-events-none">
      <div className="flex items-center gap-0.5 bg-white/95 backdrop-blur rounded-xl border border-slate-200 shadow-md p-1 pointer-events-auto">
        {TOOLS.map((t) => {
          const Icon = t.icon
          const active = tool === t.id
          return (
            <button
              key={t.id}
              type="button"
              title={t.title}
              onClick={() => onTool(t.id)}
              className={`flex items-center justify-center w-10 h-10 rounded-lg transition-colors ${
                active
                  ? "bg-indigo-600 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <Icon size={18} />
            </button>
          )
        })}
        {(onInsertImage || canPick || onNewMeasure) && (
          <div className="w-px h-6 bg-slate-200 mx-1" />
        )}
        {onInsertImage && (
          <button
            type="button"
            title="Insert image"
            onClick={onInsertImage}
            className="flex items-center justify-center w-10 h-10 rounded-lg text-slate-600 hover:bg-slate-100"
          >
            <ImagePlus size={18} />
          </button>
        )}
        {(canPick || onNewMeasure) && (
          <div className="relative">
            <button
              type="button"
              title="Insert measure"
              onClick={toggleMeasureMenu}
              className={`flex items-center justify-center w-10 h-10 rounded-lg ${
                measureOpen ? "bg-indigo-50 text-indigo-600" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <Gauge size={18} />
            </button>
            {measureOpen && (
              <div className="absolute bottom-12 left-1/2 -translate-x-1/2 w-56 max-h-72 overflow-auto bg-white rounded-lg border border-slate-200 shadow-lg p-1">
                {onNewMeasure && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        onNewMeasure()
                        setMeasureOpen(false)
                      }}
                      className="w-full flex items-center gap-2 text-left px-2 py-1.5 text-sm text-indigo-600 hover:bg-indigo-50 rounded font-medium"
                    >
                      <Sparkles size={14} /> {newMeasureLabel}
                    </button>
                    {canPick && <div className="my-1 border-t border-slate-100" />}
                  </>
                )}
                {canPick &&
                  (items === null ? (
                    <div className="px-2 py-1.5 text-xs text-slate-400">Loading…</div>
                  ) : items.length === 0 ? (
                    <div className="px-2 py-1.5 text-xs text-slate-400">No measures yet</div>
                  ) : (
                    items.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          onInsertMeasure(m.id)
                          setMeasureOpen(false)
                        }}
                        className="w-full text-left px-2 py-1.5 text-sm text-slate-700 hover:bg-indigo-50 rounded truncate"
                      >
                        {m.name}
                      </button>
                    ))
                  ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

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
    <div className="plat-toolbar">
      <div className="plat-toolbar__bar">
        {TOOLS.map((t) => {
          const Icon = t.icon
          const active = tool === t.id
          return (
            <button
              key={t.id}
              type="button"
              title={t.title}
              onClick={() => onTool(t.id)}
              className={active ? "plat-tool plat-tool--active" : "plat-tool"}
            >
              <Icon size={18} />
            </button>
          )
        })}
        {(onInsertImage || canPick || onNewMeasure) && (
          <div className="plat-toolbar__sep" />
        )}
        {onInsertImage && (
          <button
            type="button"
            title="Insert image or video"
            onClick={onInsertImage}
            className="plat-tool"
          >
            <ImagePlus size={18} />
          </button>
        )}
        {(canPick || onNewMeasure) && (
          <div style={{ position: "relative" }}>
            <button
              type="button"
              title="Insert measure"
              onClick={toggleMeasureMenu}
              className={measureOpen ? "plat-tool plat-tool--open" : "plat-tool"}
            >
              <Gauge size={18} />
            </button>
            {measureOpen && (
              <div className="plat-menu">
                {onNewMeasure && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        onNewMeasure()
                        setMeasureOpen(false)
                      }}
                      className="plat-menu__item plat-menu__item--accent"
                    >
                      <Sparkles size={14} /> {newMeasureLabel}
                    </button>
                    {canPick && <div className="plat-menu__sep" />}
                  </>
                )}
                {canPick &&
                  (items === null ? (
                    <div className="plat-menu__empty">Loading…</div>
                  ) : items.length === 0 ? (
                    <div className="plat-menu__empty">No measures yet</div>
                  ) : (
                    items.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          onInsertMeasure(m.id)
                          setMeasureOpen(false)
                        }}
                        className="plat-menu__item"
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

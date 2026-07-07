import { memo } from "react"
import type { AnyNode, ArrowNode } from "../types"
import { arrowheadPath, getArrowInfo } from "../arrows/arrow"

export const ArrowLayer = memo(function ArrowLayer({
  arrows,
  byId,
  zoom,
  selectedIds,
}: {
  arrows: ArrowNode[]
  byId: Map<string, AnyNode>
  zoom: number
  selectedIds: Set<string>
}) {
  const sw = 2 / zoom
  const head = 11 / zoom
  return (
    <svg
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: "100%",
        height: "100%",
        overflow: "visible",
        pointerEvents: "none",
      }}
    >
      {arrows.map((a) => {
        const info = getArrowInfo(a, byId)
        const color = selectedIds.has(a.id) ? "#6366f1" : a.color ?? "#334155"
        const d = info.points
          .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
          .join(" ")
        return (
          <g key={a.id} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
            <path d={d} />
            <path d={arrowheadPath(info.end, info.endDir, head)} />
          </g>
        )
      })}
    </svg>
  )
})

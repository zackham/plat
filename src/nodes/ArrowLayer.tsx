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
        const color = selectedIds.has(a.id) ? "var(--plat-selection)" : a.color ?? "var(--plat-text-secondary)"
        // "curve": a soft cubic between the endpoints (tree-link styling) —
        // control points pushed along the horizontal so parent→child reads
        // like a branch. Otherwise: straight/elbow polyline.
        const d =
          a.kind === "curve" && info.points.length >= 2
            ? (() => {
                const s = info.points[0]
                const e = info.points[info.points.length - 1]
                const bend = Math.max(24, Math.abs(e.x - s.x) / 2)
                return `M ${s.x} ${s.y} C ${s.x + bend} ${s.y}, ${e.x - bend} ${e.y}, ${e.x} ${e.y}`
              })()
            : info.points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ")
        return (
          <g key={a.id} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
            <path d={d} />
            {a.arrowhead !== "none" && <path d={arrowheadPath(info.end, info.endDir, head)} />}
          </g>
        )
      })}
    </svg>
  )
})

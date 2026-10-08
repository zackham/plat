import type { AnyNode, ImageNode, TextNode, LinkNode } from "../types"
import type { PlatNodeType } from "../nodeTypes"
import { MeasureContent } from "./MeasureNode"
import { VideoContent } from "./VideoNode"

export interface NodeContentProps {
  node: AnyNode
  readOnly: boolean
}

function ImageContent({ node }: NodeContentProps) {
  const n = node as ImageNode
  return (
    <img
      src={n.src}
      alt={n.name ?? ""}
      draggable={false}
      style={{
        width: "100%",
        height: "100%",
        objectFit: "fill",
        pointerEvents: "none",
        userSelect: "none",
        display: "block",
        borderRadius: 2,
      }}
    />
  )
}

function TextContent({ node }: NodeContentProps) {
  const n = node as TextNode
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        fontSize: n.fontSize,
        lineHeight: 1.3,
        color: n.color ?? "var(--plat-text)", // unset = theme-following; authored colors render as-is
        textAlign: n.align ?? "left",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        overflow: "hidden",
        pointerEvents: "none",
        userSelect: "none",
        padding: 2,
      }}
    >
      {n.text || (
        <span style={{ color: "var(--plat-text-faint)" }}>text</span>
      )}
    </div>
  )
}

function LinkContent({ node, readOnly }: NodeContentProps) {
  const n = node as LinkNode
  const label = n.label || n.url
  return (
    <div
      title={n.url}
      style={{
        width: "100%",
        height: "100%",
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "0 6px 0 10px",
        background: "#eff6ff",
        border: "1px solid #bfdbfe",
        borderRadius: 6,
        color: n.color ?? "#2563eb",
        fontSize: n.fontSize ?? 13,
        fontWeight: 500,
        whiteSpace: "nowrap",
        overflow: "hidden",
        userSelect: "none",
        // label area: clickable only when viewing; editor handles selection/move
        pointerEvents: readOnly ? "auto" : "none",
      }}
    >
      <span style={{ flexShrink: 0 }}>🔗</span>
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
      {/* always-clickable open affordance (works even in the editor) */}
      <a
        href={n.url}
        target="_blank"
        rel="noopener noreferrer"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        style={{
          pointerEvents: "auto",
          flexShrink: 0,
          display: "inline-flex",
          alignItems: "center",
          gap: 3,
          padding: "3px 8px",
          borderRadius: 4,
          background: "#2563eb",
          color: "#fff",
          fontSize: 11,
          fontWeight: 700,
          textDecoration: "none",
          cursor: "pointer",
        }}
      >
        open ↗
      </a>
    </div>
  )
}

// Built-in content node types, registered through the SAME PlatNodeType
// machinery hosts use for custom types (custom types are not second-class).
// group/frame/arrow are structural — owned by the engine, not listed here.
export const BUILTIN_NODE_TYPES: PlatNodeType[] = [
  { type: "image", render: ImageContent, defaultSize: { w: 400, h: 300 } },
  { type: "video", render: VideoContent, defaultSize: { w: 480, h: 270 } },
  {
    type: "text",
    render: TextContent,
    defaultProps: { text: "", fontSize: 16 },
    defaultSize: { w: 240, h: 48 },
  },
  {
    type: "measure",
    render: MeasureContent,
    defaultSize: { w: 240, h: 160 },
  },
  {
    type: "link",
    render: LinkContent,
    defaultProps: { url: "", label: "" },
    defaultSize: { w: 220, h: 36 },
  },
]

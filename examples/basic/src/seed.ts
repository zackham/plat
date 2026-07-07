// The demo document: an auto-layout frame with a text intro and live
// measures, settled headlessly with settleDoc — i.e. this file is also a
// working example of programmatic authoring (AUTHORING.md).

import { settleDoc } from "plat"
import type { AnyNode, PlatDoc } from "plat"

export function seedDoc(): PlatDoc {
  const nodes: AnyNode[] = [
    {
      id: "intro",
      type: "text",
      x: 80,
      y: 60,
      w: 460,
      h: 150,
      index: "",
      text:
        "This is a plat.\n\nDrag things around, draw arrows (A), paste screenshots, " +
        "add measures from the toolbar. The doc lives in localStorage — " +
        "Reset in the header starts over.",
      fontSize: 18,
    },
    {
      id: "kpis",
      type: "frame",
      name: "Live measures (fake data)",
      x: 80,
      y: 260,
      w: 0,
      h: 0,
      index: "a0",
      layout: {
        dir: "h",
        gap: 24,
        padding: { t: 24, r: 24, b: 24, l: 24 },
        justify: "start",
        align: "start",
        sizing: { main: "hug", cross: "hug" },
      },
    },
    {
      id: "mcard1",
      type: "measure",
      x: 0,
      y: 0,
      w: 240,
      h: 160,
      index: "000000",
      parentId: "kpis",
      measureId: "m_signups",
    },
    {
      id: "mcard2",
      type: "measure",
      x: 0,
      y: 0,
      w: 240,
      h: 160,
      index: "000001",
      parentId: "kpis",
      measureId: "m_active",
    },
    {
      id: "mcard3",
      type: "measure",
      x: 0,
      y: 0,
      w: 240,
      h: 160,
      index: "000002",
      parentId: "kpis",
      measureId: "m_notes",
    },
    {
      id: "arrow1",
      type: "arrow",
      index: "",
      start: { x: 320, y: 225, binding: { nodeId: "intro", anchor: { x: 0.5, y: 1 } } },
      end: { x: 320, y: 250, binding: { nodeId: "kpis", anchor: { x: 0.3, y: 0 } } },
      color: "#6366f1",
    },
  ]
  return { format: "plat", version: 1, nodes: settleDoc(nodes) }
}

import {
  AlignLeft,
  AlignCenter,
  AlignStartVertical,
  AlignCenterVertical,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignCenterHorizontal,
  AlignEndHorizontal,
  AlignHorizontalDistributeCenter,
  AlignVerticalDistributeCenter,
  BringToFront,
  SendToBack,
  ChevronUp,
  ChevronDown,
  Group as GroupIcon,
  Ungroup as UngroupIcon,
  Frame as FrameIcon,
} from "lucide-react"
import {
  align,
  distribute,
  frameSelection,
  group,
  ungroup,
  type AlignOp,
} from "../commands"
import { downloadOriginal } from "../export"
import { setLastArrowKind } from "../arrowPrefs"
import {
  convertToLayout,
  setLayoutProps,
  removeLayout,
  DEFAULT_LAYOUT,
} from "../layoutCommands"
import { PlatStore, selNodes, selSelected, useSel } from "../store"
import {
  isArrow,
  type AnyNode,
  type ArrowKind,
  type ArrowNode,
  type BoxNode,
  type FrameNode,
  type LayoutProps,
  type TextNode,
} from "../types"

const COLORS = ["#334155", "#6366f1", "#ef4444", "#f59e0b", "#10b981", "#0ea5e9"]
const TEXT_SIZES: { label: string; px: number }[] = [
  { label: "S", px: 16 },
  { label: "M", px: 22 },
  { label: "L", px: 32 },
  { label: "XL", px: 48 },
]

export function StylePanel({ store }: { store: PlatStore }) {
  const selectedIds = useSel(store, selSelected)
  const nodes = useSel(store, selNodes)
  if (selectedIds.length === 0) return null

  const single = selectedIds.length === 1 ? nodes[selectedIds[0]] : null
  const boxCount = selectedIds.filter((id) => nodes[id] && !isArrow(nodes[id])).length
  const canFrame = selectedIds.some((id) => {
    const n = nodes[id]
    return n && !isArrow(n) && n.type !== "group" && n.type !== "frame"
  })
  const hasGroup = selectedIds.some((id) => nodes[id]?.type === "group")
  const groupable = boxCount >= 2

  const patch = (p: Partial<AnyNode>) =>
    single && store.commit(() => store.replaceNode({ ...single, ...p } as AnyNode))

  return (
    <div className="absolute top-3 right-3 w-48 bg-white rounded-xl border border-slate-200 shadow-md p-2 pointer-events-auto flex flex-col gap-2 max-h-[calc(100%-1.5rem)] overflow-auto">
      {single && (
        <div className="flex flex-col gap-2">
          <div className="text-[10px] uppercase tracking-wide text-slate-400 px-1">{single.type}</div>
          {single.type === "arrow" && (
            <>
              <Seg
                options={[
                  { v: "straight", label: "Straight" },
                  { v: "elbow", label: "Elbow" },
                ]}
                value={(single as ArrowNode).kind ?? "straight"}
                onChange={(v) => {
                  setLastArrowKind(v as ArrowKind)
                  patch({ kind: v as ArrowNode["kind"] } as Partial<AnyNode>)
                }}
              />
              <Swatches value={(single as ArrowNode).color ?? "#334155"} onChange={(c) => patch({ color: c } as Partial<AnyNode>)} />
            </>
          )}
          {single.type === "text" && (
            <>
              <div className="flex gap-1">
                {TEXT_SIZES.map((s) => (
                  <button
                    key={s.px}
                    type="button"
                    onClick={() => patch({ fontSize: s.px } as Partial<AnyNode>)}
                    className={`flex-1 h-8 rounded text-xs ${
                      (single as TextNode).fontSize === s.px ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <div className="flex gap-1">
                <IconBtn active={(single as TextNode).align !== "center"} onClick={() => patch({ align: "left" } as Partial<AnyNode>)}>
                  <AlignLeft size={15} />
                </IconBtn>
                <IconBtn active={(single as TextNode).align === "center"} onClick={() => patch({ align: "center" } as Partial<AnyNode>)}>
                  <AlignCenter size={15} />
                </IconBtn>
              </div>
              <Swatches value={(single as TextNode).color ?? "#0f172a"} onChange={(c) => patch({ color: c } as Partial<AnyNode>)} />
            </>
          )}
          {single.type === "image" && (
            <button type="button" onClick={() => downloadOriginal(store)} className="h-8 rounded text-xs text-slate-600 hover:bg-slate-100 border border-slate-200">
              Download original
            </button>
          )}
          {single.type === "frame" && (
            <LayoutSection store={store} frame={single as FrameNode} />
          )}
          {single.type === "measure" && (
            <div className="text-[11px] text-slate-400 px-1">Use the card controls for font size & refresh.</div>
          )}
        </div>
      )}

      {/* Arrange */}
      <div className="flex flex-col gap-1.5 border-t border-slate-100 pt-2">
        <div className="text-[10px] uppercase tracking-wide text-slate-400 px-1">Arrange</div>
        <div className="flex gap-1 flex-wrap">
          {canFrame && (
            <IconBtn title="Frame selection (⌘⌥F)" onClick={() => frameSelection(store)}>
              <FrameIcon size={15} />
            </IconBtn>
          )}
          {groupable && (
            <IconBtn title="Group (⌘G)" onClick={() => group(store)}>
              <GroupIcon size={15} />
            </IconBtn>
          )}
          {hasGroup && (
            <IconBtn title="Ungroup (⌘⇧G)" onClick={() => ungroup(store)}>
              <UngroupIcon size={15} />
            </IconBtn>
          )}
        </div>
        {boxCount >= 2 && (
          <div className="flex gap-1 flex-wrap">
            <AlignBtn op="left" title="Align left"><AlignStartVertical size={15} /></AlignBtn>
            <AlignBtn op="center-x" title="Align center"><AlignCenterVertical size={15} /></AlignBtn>
            <AlignBtn op="right" title="Align right"><AlignEndVertical size={15} /></AlignBtn>
            <AlignBtn op="top" title="Align top"><AlignStartHorizontal size={15} /></AlignBtn>
            <AlignBtn op="center-y" title="Align middle"><AlignCenterHorizontal size={15} /></AlignBtn>
            <AlignBtn op="bottom" title="Align bottom"><AlignEndHorizontal size={15} /></AlignBtn>
          </div>
        )}
        {boxCount >= 3 && (
          <div className="flex gap-1">
            <IconBtn title="Distribute horizontally" onClick={() => distribute(store, "x")}>
              <AlignHorizontalDistributeCenter size={15} />
            </IconBtn>
            <IconBtn title="Distribute vertically" onClick={() => distribute(store, "y")}>
              <AlignVerticalDistributeCenter size={15} />
            </IconBtn>
          </div>
        )}
        <div className="flex gap-1">
          <IconBtn title="Bring to front" onClick={() => store.commit(() => store.bringToFront(selectedIds))}>
            <BringToFront size={15} />
          </IconBtn>
          <IconBtn title="Bring forward" onClick={() => store.commit(() => store.bringForward(selectedIds))}>
            <ChevronUp size={15} />
          </IconBtn>
          <IconBtn title="Send backward" onClick={() => store.commit(() => store.sendBackward(selectedIds))}>
            <ChevronDown size={15} />
          </IconBtn>
          <IconBtn title="Send to back" onClick={() => store.commit(() => store.sendToBack(selectedIds))}>
            <SendToBack size={15} />
          </IconBtn>
        </div>
      </div>
    </div>
  )

  function AlignBtn({ op, title, children }: { op: AlignOp; title: string; children: React.ReactNode }) {
    return (
      <IconBtn title={title} onClick={() => align(store, op)}>
        {children}
      </IconBtn>
    )
  }
}

function LayoutSection({ store, frame }: { store: PlatStore; frame: FrameNode }) {
  const L = frame.layout

  if (!L) {
    return (
      <div className="flex flex-col gap-1">
        <button
          type="button"
          onClick={() => {
            const nodes = store.getState().nodes
            // flow the frame's box children, honoring any pre-set layoutIgnore;
            // initial flow order follows current geometry (left→right, top→down).
            const kids = (Object.values(nodes).filter(
              (n) => !isArrow(n) && (n as BoxNode).parentId === frame.id && !(n as BoxNode).layoutIgnore,
            ) as BoxNode[]).sort((a, b) => a.x - b.x || a.y - b.y)
            convertToLayout(store, frame.id, kids.map((k) => k.id), DEFAULT_LAYOUT)
          }}
          className="h-8 rounded text-xs bg-indigo-600 text-white hover:bg-indigo-500"
        >
          + Auto-layout
        </button>
        <div className="text-[10px] text-slate-400 px-1">Double-click the title to rename.</div>
      </div>
    )
  }

  const set = (p: Partial<LayoutProps>) => setLayoutProps(store, frame.id, p)
  const SizeSeg = ({ axis }: { axis: "main" | "cross" }) => (
    <div className="flex items-center gap-1">
      <span className="text-[10px] text-slate-400 w-9">{axis === "main" ? "Main" : "Cross"}</span>
      <Seg
        options={[
          { v: "hug", label: "Hug" },
          { v: "fixed", label: "Fixed" },
        ]}
        value={L.sizing[axis]}
        onChange={(v) => set({ sizing: { [axis]: v } as Partial<LayoutProps["sizing"]> as LayoutProps["sizing"] })}
      />
    </div>
  )

  return (
    <div className="flex flex-col gap-1.5">
      <Seg
        options={[
          { v: "h", label: "Row" },
          { v: "v", label: "Column" },
        ]}
        value={L.dir}
        onChange={(v) => set({ dir: v as "h" | "v" })}
      />
      <div className="flex gap-1">
        <NumField label="Gap" value={L.gap} onChange={(n) => set({ gap: n })} />
        <NumField label="Pad" value={L.padding.t} onChange={(n) => set({ padding: { t: n, r: n, b: n, l: n } })} />
      </div>
      <Seg
        options={[
          { v: "start", label: "├" },
          { v: "center", label: "┼" },
          { v: "end", label: "┤" },
          { v: "space-between", label: "↔" },
        ]}
        value={L.justify}
        onChange={(v) => set({ justify: v as LayoutProps["justify"] })}
      />
      <Seg
        options={[
          { v: "start", label: "Start" },
          { v: "center", label: "Center" },
          { v: "end", label: "End" },
        ]}
        value={L.align}
        onChange={(v) => set({ align: v as LayoutProps["align"] })}
      />
      <SizeSeg axis="main" />
      <SizeSeg axis="cross" />
      <button
        type="button"
        onClick={() => removeLayout(store, frame.id)}
        className="h-7 rounded text-[11px] text-slate-500 hover:bg-slate-100 border border-slate-200"
      >
        Remove auto-layout
      </button>
    </div>
  )
}

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <label className="flex-1 min-w-0 flex items-center gap-1 text-[11px] text-slate-500">
      <span className="w-7">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="w-full min-w-0 px-1 py-0.5 border border-slate-200 rounded text-xs"
      />
    </label>
  )
}

function Seg({ options, value, onChange }: { options: { v: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5">
      {options.map((o) => (
        <button key={o.v} type="button" onClick={() => onChange(o.v)} className={`flex-1 h-7 rounded-md text-xs ${value === o.v ? "bg-white shadow-sm text-slate-900" : "text-slate-500"}`}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Swatches({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex gap-1 flex-wrap">
      {COLORS.map((c) => (
        <button key={c} type="button" onClick={() => onChange(c)} className={`w-6 h-6 rounded-full ${value === c ? "ring-2 ring-offset-1 ring-indigo-500" : ""}`} style={{ background: c }} />
      ))}
    </div>
  )
}

function IconBtn({ active, onClick, title, children }: { active?: boolean; onClick: () => void; title?: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`flex items-center justify-center w-8 h-8 rounded ${active ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}
    >
      {children}
    </button>
  )
}

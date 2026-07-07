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
    <div className="plat-panel">
      {single && (
        <div className="plat-panel__group">
          <div className="plat-panel__title">{single.type}</div>
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
              <div className="plat-panel__row">
                {TEXT_SIZES.map((s) => (
                  <button
                    key={s.px}
                    type="button"
                    onClick={() => patch({ fontSize: s.px } as Partial<AnyNode>)}
                    className={`plat-seg__btn${(single as TextNode).fontSize === s.px ? " plat-seg__btn--active" : ""}`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <div className="plat-panel__row">
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
            <button type="button" onClick={() => downloadOriginal(store)} className="plat-btn">
              Download original
            </button>
          )}
          {single.type === "frame" && (
            <LayoutSection store={store} frame={single as FrameNode} />
          )}
          {single.type === "measure" && (
            <div className="plat-panel__hint plat-panel__hint--lg">Use the card controls for font size & refresh.</div>
          )}
        </div>
      )}

      {/* Arrange */}
      <div className="plat-panel__group plat-panel__group--arrange">
        <div className="plat-panel__title">Arrange</div>
        <div className="plat-panel__row plat-panel__row--wrap">
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
          <div className="plat-panel__row plat-panel__row--wrap">
            <AlignBtn store={store} op="left" title="Align left"><AlignStartVertical size={15} /></AlignBtn>
            <AlignBtn store={store} op="center-x" title="Align center"><AlignCenterVertical size={15} /></AlignBtn>
            <AlignBtn store={store} op="right" title="Align right"><AlignEndVertical size={15} /></AlignBtn>
            <AlignBtn store={store} op="top" title="Align top"><AlignStartHorizontal size={15} /></AlignBtn>
            <AlignBtn store={store} op="center-y" title="Align middle"><AlignCenterHorizontal size={15} /></AlignBtn>
            <AlignBtn store={store} op="bottom" title="Align bottom"><AlignEndHorizontal size={15} /></AlignBtn>
          </div>
        )}
        {boxCount >= 3 && (
          <div className="plat-panel__row">
            <IconBtn title="Distribute horizontally" onClick={() => distribute(store, "x")}>
              <AlignHorizontalDistributeCenter size={15} />
            </IconBtn>
            <IconBtn title="Distribute vertically" onClick={() => distribute(store, "y")}>
              <AlignVerticalDistributeCenter size={15} />
            </IconBtn>
          </div>
        )}
        <div className="plat-panel__row">
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
}

function AlignBtn({
  store,
  op,
  title,
  children,
}: {
  store: PlatStore
  op: AlignOp
  title: string
  children: React.ReactNode
}) {
  return (
    <IconBtn title={title} onClick={() => align(store, op)}>
      {children}
    </IconBtn>
  )
}

function LayoutSection({ store, frame }: { store: PlatStore; frame: FrameNode }) {
  const L = frame.layout

  if (!L) {
    return (
      <div className="plat-panel__group plat-panel__group--tight">
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
          className="plat-btn plat-btn--primary"
        >
          + Auto-layout
        </button>
        <div className="plat-panel__hint">Double-click the title to rename.</div>
      </div>
    )
  }

  const set = (p: Partial<LayoutProps>) => setLayoutProps(store, frame.id, p)

  return (
    <div className="plat-panel__group plat-panel__group--tight">
      <Seg
        options={[
          { v: "h", label: "Row" },
          { v: "v", label: "Column" },
        ]}
        value={L.dir}
        onChange={(v) => set({ dir: v as "h" | "v" })}
      />
      <div className="plat-panel__row">
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
      <SizeSeg axis="main" layout={L} onSet={set} />
      <SizeSeg axis="cross" layout={L} onSet={set} />
      <button type="button" onClick={() => removeLayout(store, frame.id)} className="plat-btn plat-btn--sm">
        Remove auto-layout
      </button>
    </div>
  )
}

function SizeSeg({
  axis,
  layout,
  onSet,
}: {
  axis: "main" | "cross"
  layout: LayoutProps
  onSet: (p: Partial<LayoutProps>) => void
}) {
  return (
    <div className="plat-size-row">
      <span className="plat-size-row__label">{axis === "main" ? "Main" : "Cross"}</span>
      <Seg
        options={[
          { v: "hug", label: "Hug" },
          { v: "fixed", label: "Fixed" },
        ]}
        value={layout.sizing[axis]}
        onChange={(v) =>
          onSet({ sizing: { ...layout.sizing, [axis]: v } as LayoutProps["sizing"] })
        }
      />
    </div>
  )
}

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <label className="plat-num">
      <span className="plat-num__label">{label}</span>
      <input type="number" value={value} onChange={(e) => onChange(Number(e.target.value) || 0)} />
    </label>
  )
}

function Seg({ options, value, onChange }: { options: { v: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="plat-seg">
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(o.v)}
          className={`plat-seg__btn${value === o.v ? " plat-seg__btn--active" : ""}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Swatches({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="plat-panel__row plat-panel__row--wrap">
      {COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className={`plat-swatch${value === c ? " plat-swatch--active" : ""}`}
          style={{ background: c }}
        />
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
      className={`plat-icon-btn${active ? " plat-icon-btn--active" : ""}`}
    >
      {children}
    </button>
  )
}

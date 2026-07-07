import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { ChevronRight } from "lucide-react"
import { align, distribute, frameSelection, group, ungroup } from "../commands"
import { canDownloadOriginal } from "../export"
import type { PlatStore } from "../store"
import { isArrow } from "../types"

export interface ContextActions {
  cut: () => void
  copy: () => void
  paste: () => void
  duplicate: () => void
  remove: () => void
  copyPng: () => void
  download: () => void
}

export function ContextMenu({
  store,
  pos,
  onClose,
  actions,
}: {
  store: PlatStore
  pos: { x: number; y: number }
  onClose: () => void
  actions: ContextActions
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [clamped, setClamped] = useState(pos)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setClamped({
      x: Math.max(8, Math.min(pos.x, window.innerWidth - r.width - 8)),
      y: Math.max(8, Math.min(pos.y, window.innerHeight - r.height - 8)),
    })
  }, [pos])
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose()
    window.addEventListener("pointerdown", onDown, true)
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("pointerdown", onDown, true)
      window.removeEventListener("keydown", onKey)
    }
  }, [onClose])

  const s = store.getState()
  const sel = s.selectedIds
  const hasSel = sel.length > 0
  const hasGroup = sel.some((id) => s.nodes[id]?.type === "group")
  const groupable = sel.filter((id) => s.nodes[id] && !isArrow(s.nodes[id])).length >= 2
  const frameable = sel.some((id) => {
    const n = s.nodes[id]
    return n && !isArrow(n) && n.type !== "group" && n.type !== "frame"
  })
  const canDl = canDownloadOriginal(store)

  const run = (fn: () => void) => () => {
    fn()
    onClose()
  }

  return (
    <div
      ref={ref}
      className="fixed z-[10000] min-w-[180px] bg-white rounded-lg border border-slate-200 shadow-xl py-1 text-sm text-slate-700"
      style={{ left: clamped.x, top: clamped.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Item label="Cut" hint="⌘X" disabled={!hasSel} onClick={run(actions.cut)} />
      <Item label="Copy" hint="⌘C" disabled={!hasSel} onClick={run(actions.copy)} />
      <Item label="Paste" hint="⌘V" onClick={run(actions.paste)} />
      <Item label="Duplicate" hint="⌘D" disabled={!hasSel} onClick={run(actions.duplicate)} />
      <Sep />
      <Item label="Copy as PNG" disabled={!hasSel} onClick={run(actions.copyPng)} />
      {canDl && <Item label="Download original" onClick={run(actions.download)} />}
      <Sep />
      {frameable && <Item label="Frame selection" hint="⌘⌥F" onClick={run(() => frameSelection(store))} />}
      {groupable && <Item label="Group" hint="⌘G" onClick={run(() => group(store))} />}
      {hasGroup && <Item label="Ungroup" hint="⌘⇧G" onClick={run(() => ungroup(store))} />}
      <Submenu label="Align" disabled={sel.length < 2}>
        <Item label="Left" onClick={run(() => align(store, "left"))} />
        <Item label="Center horizontal" onClick={run(() => align(store, "center-x"))} />
        <Item label="Right" onClick={run(() => align(store, "right"))} />
        <Item label="Top" onClick={run(() => align(store, "top"))} />
        <Item label="Center vertical" onClick={run(() => align(store, "center-y"))} />
        <Item label="Bottom" onClick={run(() => align(store, "bottom"))} />
      </Submenu>
      <Submenu label="Distribute" disabled={sel.length < 3}>
        <Item label="Horizontal" onClick={run(() => distribute(store, "x"))} />
        <Item label="Vertical" onClick={run(() => distribute(store, "y"))} />
      </Submenu>
      <Submenu label="Reorder" disabled={!hasSel}>
        <Item label="Bring to front" onClick={run(() => store.commit(() => store.bringToFront(sel)))} />
        <Item label="Bring forward" onClick={run(() => store.commit(() => store.bringForward(sel)))} />
        <Item label="Send backward" onClick={run(() => store.commit(() => store.sendBackward(sel)))} />
        <Item label="Send to back" onClick={run(() => store.commit(() => store.sendToBack(sel)))} />
      </Submenu>
      <Sep />
      <Item label="Delete" hint="⌫" disabled={!hasSel} danger onClick={run(actions.remove)} />
    </div>
  )
}

function Item({
  label,
  hint,
  disabled,
  danger,
  onClick,
}: {
  label: string
  hint?: string
  disabled?: boolean
  danger?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`w-full flex items-center justify-between gap-6 px-3 h-8 text-left ${
        disabled
          ? "text-slate-300 cursor-default"
          : danger
            ? "text-rose-600 hover:bg-rose-50"
            : "hover:bg-indigo-50"
      }`}
    >
      <span>{label}</span>
      {hint && <span className="text-[11px] text-slate-400">{hint}</span>}
    </button>
  )
}

function Sep() {
  return <div className="my-1 border-t border-slate-100" />
}

function Submenu({ label, disabled, children }: { label: string; disabled?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const [flip, setFlip] = useState<{ left: boolean; up: boolean }>({ left: false, up: false })
  const triggerRef = useRef<HTMLDivElement>(null)
  if (disabled)
    return (
      <div className="w-full flex items-center justify-between px-3 h-8 text-slate-300">
        <span>{label}</span>
        <ChevronRight size={14} />
      </div>
    )
  const onEnter = () => {
    const r = triggerRef.current?.getBoundingClientRect()
    if (r) {
      setFlip({
        left: r.right + 190 > window.innerWidth,
        up: r.top + 260 > window.innerHeight,
      })
    }
    setOpen(true)
  }
  return (
    <div className="relative" ref={triggerRef} onMouseEnter={onEnter} onMouseLeave={() => setOpen(false)}>
      <div className="w-full flex items-center justify-between px-3 h-8 hover:bg-indigo-50 cursor-default">
        <span>{label}</span>
        <ChevronRight size={14} />
      </div>
      {open && (
        <div
          className={`absolute min-w-[180px] bg-white rounded-lg border border-slate-200 shadow-xl py-1 ${
            flip.left ? "right-full" : "left-full"
          } ${flip.up ? "bottom-0 mb-[-4px]" : "top-0 mt-[-4px]"}`}
        >
          {children}
        </div>
      )}
    </div>
  )
}

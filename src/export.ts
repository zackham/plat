// Rasterize a selection to a PNG (at on-screen 100% size) and copy to the
// system clipboard, plus download-original for image and video nodes. Images render
// pixel-exact (the primary round-trip use case); text/measure are approximated
// onto the canvas.

import type { PlatStore } from "./store"
import { boxNode, unionBoxes } from "./geometry"
import { isArrow, type BoxNode, type ImageNode, type TextNode, type VideoNode } from "./types"

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

function selectedBoxNodes(store: PlatStore): BoxNode[] {
  const s = store.getState()
  const sel = new Set(s.selectedIds)
  // include group members
  for (const id of s.selectedIds) {
    const n = s.nodes[id]
    if (n && !isArrow(n) && n.type === "group") {
      for (const k of s.order) {
        const c = s.nodes[k]
        if (c && !isArrow(c) && (c as BoxNode).parentId === id) sel.add(k)
      }
    }
  }
  return s.order
    .filter((id) => sel.has(id))
    .map((id) => s.nodes[id])
    .filter((n): n is BoxNode => !!n && !isArrow(n) && n.type !== "group")
}

/** Render the current selection to a PNG blob at 1px-per-page-unit (100%). */
export async function renderSelectionPng(store: PlatStore): Promise<Blob | null> {
  const boxes = selectedBoxNodes(store)
  if (boxes.length === 0) return null
  const bounds = unionBoxes(boxes.map(boxNode))!
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(bounds.w * dpr))
  canvas.height = Math.max(1, Math.round(bounds.h * dpr))
  const ctx = canvas.getContext("2d")
  if (!ctx) return null
  ctx.scale(dpr, dpr)

  for (const n of boxes) {
    const x = n.x - bounds.x
    const y = n.y - bounds.y
    if (n.type === "image") {
      try {
        const img = await loadImage((n as ImageNode).src)
        ctx.drawImage(img, x, y, n.w, n.h)
      } catch {
        /* skip unloadable image */
      }
    } else if (n.type === "video") {
      // the poster frame stands in for the clip; no poster ⇒ a dark box
      const poster = (n as VideoNode).poster
      let drawn = false
      if (poster) {
        try {
          ctx.drawImage(await loadImage(poster), x, y, n.w, n.h)
          drawn = true
        } catch {
          /* fall through to the placeholder */
        }
      }
      if (!drawn) {
        ctx.fillStyle = "#0f172a"
        ctx.fillRect(x, y, n.w, n.h)
      }
    } else if (n.type === "text") {
      const t = n as TextNode
      ctx.fillStyle = t.color ?? "#0f172a"
      ctx.font = `${t.fontSize}px ui-sans-serif, system-ui, sans-serif`
      ctx.textBaseline = "top"
      let yy = y + 2
      for (const line of (t.text || "").split("\n")) {
        ctx.fillText(line, x + 2, yy)
        yy += t.fontSize * 1.3
      }
    } else if (n.type === "measure") {
      // approximate the card
      ctx.fillStyle = "#eef2ff"
      ctx.fillRect(x, y, n.w, n.h)
      ctx.strokeStyle = "#c7d2fe"
      ctx.strokeRect(x, y, n.w, n.h)
    }
  }
  return await new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"))
}

export async function copySelectionAsPng(store: PlatStore): Promise<boolean> {
  const blob = await renderSelectionPng(store)
  if (!blob) return false
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })])
    return true
  } catch {
    // fallback: download it
    triggerDownload(URL.createObjectURL(blob), "canvas-selection.png")
    return true
  }
}

function triggerDownload(url: string, filename: string) {
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}

const isMedia = (n: { type: string } | undefined): boolean =>
  n?.type === "image" || n?.type === "video"

/** Download the stored source file for a single selected image or video node. */
export async function downloadOriginal(store: PlatStore): Promise<boolean> {
  const s = store.getState()
  const media = s.selectedIds
    .map((id) => s.nodes[id])
    .filter((n): n is ImageNode | VideoNode => !!n && !isArrow(n) && isMedia(n))
  if (media.length !== 1) return false
  const n = media[0]
  try {
    const res = await fetch(n.src)
    const blob = await res.blob()
    const fallback = n.type === "video" ? "mp4" : "png"
    const ext = (blob.type.split("/")[1] || fallback).split("+")[0]
    const url = URL.createObjectURL(blob)
    triggerDownload(url, n.name || `${n.type}.${ext}`)
    setTimeout(() => URL.revokeObjectURL(url), 5000)
    return true
  } catch {
    return false
  }
}

export function canDownloadOriginal(store: PlatStore): boolean {
  const s = store.getState()
  return s.selectedIds.length === 1 && isMedia(s.nodes[s.selectedIds[0]])
}

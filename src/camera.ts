import type { Camera, Vec } from "./types"

export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 8

export const clampZoom = (z: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z))

// IMPORTANT: all of these take CONTAINER-RELATIVE screen coords (clientXY minus
// the container's bounding-rect origin). Convert once at the event boundary via
// `toContainerPoint`. This keeps every formula consistent (the P0 bug was the
// zoom math using raw clientX while screenToPage subtracted bounds).

export function toContainerPoint(
  clientX: number,
  clientY: number,
  rect: DOMRect,
): Vec {
  return { x: clientX - rect.left, y: clientY - rect.top }
}

/** container-relative screen point -> page point */
export function screenToPage(s: Vec, cam: Camera): Vec {
  return { x: s.x / cam.z - cam.x, y: s.y / cam.z - cam.y }
}

/** page point -> container-relative screen point */
export function pageToScreen(p: Vec, cam: Camera): Vec {
  return { x: (p.x + cam.x) * cam.z, y: (p.y + cam.y) * cam.z }
}

/**
 * Normalize a wheel deltaY into a bounded zoom step: clamp the per-event delta
 * to ±10px, then divide by 100 for a max ±0.1 step. The clamp is what makes
 * wheel zoom feel controlled (vs an exponential that compounds per event).
 */
export function wheelZoomDelta(deltaY: number): number {
  const d = Math.abs(deltaY) > 10 ? 10 * Math.sign(deltaY) : deltaY
  return -d / 100 // negative: scroll up -> zoom in
}

/**
 * Zoom toward a container-relative cursor, keeping that page point fixed.
 * ADDITIVE step scaled by the current zoom: newZ = z + delta*z.
 */
export function zoomToward(cam: Camera, cursor: Vec, delta: number): Camera {
  const newZ = clampZoom(cam.z + delta * cam.z)
  if (newZ === cam.z) return cam
  const x = cam.x + cursor.x / newZ - cursor.x / cam.z
  const y = cam.y + cursor.y / newZ - cursor.y / cam.z
  return { x, y, z: newZ }
}

/** Set zoom to an absolute value while keeping a container point fixed. */
export function zoomToAt(cam: Camera, cursor: Vec, targetZ: number): Camera {
  const newZ = clampZoom(targetZ)
  const x = cam.x + cursor.x / newZ - cursor.x / cam.z
  const y = cam.y + cursor.y / newZ - cursor.y / cam.z
  return { x, y, z: newZ }
}

/** Wheel/scroll pan: content moves OPPOSITE the scroll (natural scrolling). */
export function panBy(cam: Camera, dxScreen: number, dyScreen: number): Camera {
  return { x: cam.x - dxScreen / cam.z, y: cam.y - dyScreen / cam.z, z: cam.z }
}

/**
 * Two-finger pinch update: scale about the (container-relative) finger
 * midpoint by the distance ratio, then follow the midpoint's screen movement
 * so the content tracks the fingers while zooming.
 */
export function pinchCamera(
  cam: Camera,
  center: Vec,
  centerDelta: Vec,
  distRatio: number,
): Camera {
  const zoomed =
    Number.isFinite(distRatio) && distRatio > 0
      ? zoomToAt(cam, center, cam.z * distRatio)
      : cam
  return dragPan(zoomed, centerDelta.x, centerDelta.y)
}

/** Grab/hand drag: content FOLLOWS the cursor 1:1 (camera adds the delta). */
export function dragPan(cam: Camera, dxScreen: number, dyScreen: number): Camera {
  return { x: cam.x + dxScreen / cam.z, y: cam.y + dyScreen / cam.z, z: cam.z }
}

export const cameraTransform = (cam: Camera) =>
  `scale(${cam.z}) translate(${cam.x}px, ${cam.y}px)`

/** Normalize a wheel event's deltas to pixels (lines/pages -> px). */
export function normalizeWheel(e: WheelEvent): { dx: number; dy: number } {
  let { deltaX: dx, deltaY: dy } = e
  if (e.deltaMode === 1) {
    // lines
    dx *= 16
    dy *= 16
  } else if (e.deltaMode === 2) {
    // pages
    dx *= window.innerWidth
    dy *= window.innerHeight
  }
  return { dx, dy }
}

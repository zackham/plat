import { describe, it, expect } from "vitest"
import { MAX_ZOOM, pinchCamera, screenToPage } from "../camera"

describe("camera: pinchCamera", () => {
  const cam = { x: 0, y: 0, z: 1 }

  it("zooms about the pinch center (page point under fingers stays fixed)", () => {
    const center = { x: 100, y: 50 }
    const before = screenToPage(center, cam)
    const next = pinchCamera(cam, center, { x: 0, y: 0 }, 2)
    expect(next.z).toBeCloseTo(2)
    const after = screenToPage(center, next)
    expect(after.x).toBeCloseTo(before.x)
    expect(after.y).toBeCloseTo(before.y)
  })

  it("follows the midpoint movement 1:1 in screen space", () => {
    const next = pinchCamera(cam, { x: 100, y: 50 }, { x: 10, y: -5 }, 1)
    expect(next.z).toBe(1)
    expect(next.x).toBeCloseTo(10)
    expect(next.y).toBeCloseTo(-5)
  })

  it("composes zoom and pan in one update", () => {
    // fingers spread 1.5x while drifting right 20px: the page point that was
    // under the OLD center should land 20 screen-px right of the NEW center
    const center = { x: 200, y: 100 }
    const before = screenToPage(center, cam)
    const next = pinchCamera(cam, center, { x: 20, y: 0 }, 1.5)
    const after = screenToPage({ x: center.x + 20, y: center.y }, next)
    expect(after.x).toBeCloseTo(before.x)
    expect(after.y).toBeCloseTo(before.y)
  })

  it("ignores degenerate distance ratios", () => {
    expect(pinchCamera(cam, { x: 0, y: 0 }, { x: 0, y: 0 }, 0)).toEqual(cam)
    expect(pinchCamera(cam, { x: 0, y: 0 }, { x: 0, y: 0 }, NaN)).toEqual(cam)
    expect(pinchCamera(cam, { x: 0, y: 0 }, { x: 0, y: 0 }, Infinity)).toEqual(cam)
  })

  it("clamps to MAX_ZOOM", () => {
    const next = pinchCamera({ x: 0, y: 0, z: 7 }, { x: 50, y: 50 }, { x: 0, y: 0 }, 3)
    expect(next.z).toBe(MAX_ZOOM)
  })
})

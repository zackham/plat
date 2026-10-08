// The built-in video node: playback-mode derivation, rendering, and the
// interactive-region split (controls click, body still drags/selects).

import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Plat } from "../Plat"
import { videoPlayback, VIDEO_LOOP_MAX_SECONDS } from "../types"
import type { PlatDoc, PlatHost } from "../index"

afterEach(cleanup)

const docWith = (nodes: PlatDoc["nodes"]): PlatDoc => ({ format: "plat", version: 1, nodes })
const host = (doc: PlatDoc): PlatHost => ({ loadDoc: async () => doc, saveDoc: vi.fn(async () => {}) })

const clip = (over: Record<string, unknown> = {}) =>
  ({
    id: "v1",
    type: "video",
    x: 0,
    y: 0,
    w: 480,
    h: 270,
    index: "",
    src: "/a/clip.mp4",
    poster: "/a/clip.jpg",
    ...over,
  }) as PlatDoc["nodes"][number]

describe("videoPlayback", () => {
  it("loops short silent clips", () => {
    expect(videoPlayback({ duration: 12, hasAudio: false })).toBe("loop")
    expect(videoPlayback({ duration: VIDEO_LOOP_MAX_SECONDS, hasAudio: false })).toBe("loop")
  })
  it("uses click for long clips, clips with audio, and unknowns", () => {
    expect(videoPlayback({ duration: VIDEO_LOOP_MAX_SECONDS + 1, hasAudio: false })).toBe("click")
    expect(videoPlayback({ duration: 5, hasAudio: true })).toBe("click")
    expect(videoPlayback({ duration: 5 })).toBe("click")
    expect(videoPlayback({})).toBe("click")
  })
  it("an explicit playback mode wins", () => {
    expect(videoPlayback({ duration: 300, hasAudio: true, playback: "loop" })).toBe("loop")
    expect(videoPlayback({ duration: 5, hasAudio: false, playback: "click" })).toBe("click")
  })
})

describe("video node", () => {
  it("renders a muted looping <video> for a short silent clip, with no play button", async () => {
    const { container } = render(<Plat host={host(docWith([clip({ duration: 8, hasAudio: false })]))} />)
    await screen.findByLabelText("Fullscreen")
    const v = container.querySelector("video")!
    expect(v.getAttribute("src")).toBe("/a/clip.mp4")
    expect(v.getAttribute("poster")).toBe("/a/clip.jpg")
    expect(v.loop).toBe(true)
    expect(v.muted).toBe(true)
    expect(screen.queryByLabelText("Play video")).toBeNull()
    // silent clip ⇒ no mute control
    expect(screen.queryByLabelText("Unmute")).toBeNull()
  })

  it("click mode shows a play button that plays the clip", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined)
    const { container } = render(<Plat host={host(docWith([clip({ duration: 120, hasAudio: true })]))} />)
    const btn = await screen.findByLabelText("Play video")
    expect(container.querySelector("video")!.loop).toBe(false)
    fireEvent.click(btn)
    expect(play).toHaveBeenCalled()
    play.mockRestore()
  })

  it("controls are interactive regions: pointerdown selects the node without dragging it", async () => {
    let api: import("../api").PlatApi | null = null
    render(
      <Plat host={host(docWith([clip({ duration: 120, hasAudio: true })]))} onReady={(a) => (api = a)} />,
    )
    const btn = await screen.findByLabelText("Play video")
    fireEvent.pointerDown(btn, { button: 0, clientX: 240, clientY: 135 })
    fireEvent.pointerMove(btn, { clientX: 340, clientY: 235 })
    expect(api!.getSelection()).toEqual(["v1"])
    const n = api!.getNode("v1") as { x: number; y: number }
    expect([n.x, n.y]).toEqual([0, 0])
  })

  it("api.create seeds a 16:9 default size", async () => {
    let api: import("../api").PlatApi | null = null
    render(<Plat host={host(docWith([]))} onReady={(a) => (api = a)} />)
    await screen.findByTitle("Select (V)")
    const [made] = api!.create({ type: "video", x: 0, y: 0, src: "/a/b.mp4" })
    expect([(made as { w: number }).w, (made as { h: number }).h]).toEqual([480, 270])
  })
})

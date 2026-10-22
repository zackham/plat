// host.linkTo + <Plat focus>: copy-link from both menus, and first-fit framing.

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Plat } from "../Plat"
import type { PlatDoc, PlatHost, PlatApi } from "../index"

const doc: PlatDoc = {
  format: "plat",
  version: 1,
  nodes: [
    { id: "t1", type: "text", x: 0, y: 0, w: 200, h: 40, index: "a0", text: "first", fontSize: 16 },
    { id: "t2", type: "text", x: 3000, y: 2000, w: 200, h: 40, index: "a1", text: "far", fontSize: 16 },
  ],
}

let writeText: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, width: 1000, height: 800, right: 1000, bottom: 800, toJSON: () => ({}),
  } as DOMRect)
  writeText = vi.fn(async () => {})
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

async function mount(props: { host: PlatHost; readOnly?: boolean; focus?: string[] }) {
  let api: PlatApi | null = null
  render(<Plat {...props} onReady={(a) => (api = a)} />)
  await screen.findByText("first")
  await waitFor(() => expect(api).not.toBeNull())
  return api as unknown as PlatApi
}

// page point → client point under the current camera (client = (page + cam) * z)
function clientOf(api: PlatApi, px: number, py: number) {
  const c = api.getCamera()
  return { clientX: (px + c.x) * c.z, clientY: (py + c.y) * c.z }
}

describe("focus", () => {
  it("frames the focused node at most 1:1 instead of fitting everything", async () => {
    const api = await mount({ host: { loadDoc: async () => doc }, focus: ["t2"] })
    await waitFor(() => expect(api.getCamera().z).toBe(1))
    const c = api.getCamera()
    expect(c.x).toBe(500 - 3100)
    expect(c.y).toBe(400 - 2020)
  })

  it("an unknown id falls back to fit-all and tells the host", async () => {
    const notify = vi.fn()
    const api = await mount({ host: { loadDoc: async () => doc, notify }, focus: ["gone"] })
    await waitFor(() => expect(notify).toHaveBeenCalledWith("error", expect.stringMatching(/no longer/)))
    expect(api.getCamera().z).toBeLessThan(1)
  })
})

describe("copy link", () => {
  it("read-only: right-click a node offers only Copy link, for that node", async () => {
    const linkTo = vi.fn((ids: string[]) => `https://x/p?focus=${ids.join(",")}`)
    const api = await mount({ host: { loadDoc: async () => doc, linkTo }, readOnly: true, focus: ["t1"] })
    fireEvent.contextMenu(document.querySelector(".plat-viewport")!, clientOf(api, 100, 20))
    expect(screen.queryByText("Paste")).not.toBeInTheDocument()
    fireEvent.click(screen.getByText("Copy link"))
    expect(linkTo).toHaveBeenCalledWith(["t1"])
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("https://x/p?focus=t1"))
  })

  it("read-only without linkTo: no menu at all", async () => {
    const api = await mount({ host: { loadDoc: async () => doc }, readOnly: true, focus: ["t1"] })
    fireEvent.contextMenu(document.querySelector(".plat-viewport")!, clientOf(api, 100, 20))
    expect(screen.queryByText("Copy link")).not.toBeInTheDocument()
  })

  it("editor: Copy link acts on the whole selection", async () => {
    const linkTo = vi.fn((ids: string[]) => ids.join(","))
    const api = await mount({ host: { loadDoc: async () => doc, saveDoc: async () => {}, linkTo }, focus: ["t1"] })
    act(() => api.select(["t1", "t2"]))
    fireEvent.contextMenu(document.querySelector(".plat-viewport")!, clientOf(api, 100, 20))
    fireEvent.click(screen.getByText("Copy link"))
    expect(linkTo).toHaveBeenCalledWith(["t1", "t2"])
  })
})

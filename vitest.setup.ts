import "@testing-library/jest-dom/vitest"

// jsdom ships no PointerEvent, so fireEvent.pointerDown(...) can't carry
// button/pointerType/pointerId — which pointer-interaction tests need. Polyfill
// a minimal one (extends MouseEvent, so `button` works) when it's missing.
if (typeof (globalThis as { PointerEvent?: unknown }).PointerEvent !== "function") {
  class PointerEvent extends MouseEvent {
    pointerId: number
    pointerType: string
    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params)
      this.pointerId = params.pointerId ?? 0
      this.pointerType = params.pointerType ?? ""
    }
  }
  ;(globalThis as unknown as { PointerEvent: unknown }).PointerEvent = PointerEvent
}

// Remembers the last arrow kind the user picked so the arrow tool draws the
// same kind next time (persisted across reloads via localStorage).

import type { ArrowKind } from "./types"

const KEY = "plat:lastArrowKind"

// Explicit SSR guard: no window ⇒ no persistence, silently. The try/catch
// additionally covers private-mode/disabled storage in browsers.
const storage = (): Storage | null =>
  typeof window === "undefined" ? null : window.localStorage

export function getLastArrowKind(): ArrowKind {
  try {
    return storage()?.getItem(KEY) === "elbow" ? "elbow" : "straight"
  } catch {
    return "straight"
  }
}

export function setLastArrowKind(kind: ArrowKind): void {
  try {
    storage()?.setItem(KEY, kind)
  } catch {
    // private mode / disabled storage — non-fatal, just don't remember
  }
}

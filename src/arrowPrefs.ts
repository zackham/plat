// Remembers the last arrow kind the user picked so the arrow tool draws the
// same kind next time (persisted across reloads via localStorage).

import type { ArrowKind } from "./types"

const KEY = "canvas:lastArrowKind"

export function getLastArrowKind(): ArrowKind {
  try {
    return localStorage.getItem(KEY) === "elbow" ? "elbow" : "straight"
  } catch {
    return "straight"
  }
}

export function setLastArrowKind(kind: ArrowKind): void {
  try {
    localStorage.setItem(KEY, kind)
  } catch {
    // private mode / disabled storage — non-fatal, just don't remember
  }
}

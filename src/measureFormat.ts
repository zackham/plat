// Measure value/text formatting conventions — the render half of the measure
// contract. Exported from the library entry so hosts and programmatic authors
// can format values exactly the way MeasureNode will render them.

export function pickValue(
  result: Record<string, unknown> | null | undefined,
  key = "value",
): unknown {
  if (!result) return undefined
  if (key in result) return result[key]
  if ("value" in result) return result["value"]
  return undefined
}

export function pickText(
  result: Record<string, unknown> | null | undefined,
): string | undefined {
  if (!result) return undefined
  for (const k of ["text", "list_text", "label"]) {
    const v = result[k]
    if (typeof v === "string" && v.length > 0) return v
  }
  return undefined
}

export function formatValue(v: unknown): string {
  if (typeof v === "number") {
    if (!isFinite(v)) return String(v)
    const a = Math.abs(v)
    if (a !== 0 && a < 1) return (v * 100).toFixed(1) + "%"
    if (a >= 1_000_000) return (v / 1_000_000).toFixed(2) + "M"
    if (a >= 1_000) return (v / 1_000).toFixed(1) + "k"
    return Math.round(v).toLocaleString()
  }
  if (typeof v === "string") return v
  return JSON.stringify(v)
}

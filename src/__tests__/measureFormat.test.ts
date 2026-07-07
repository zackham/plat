import { describe, expect, it } from "vitest"
import { formatValue, pickText, pickValue } from "../measureFormat"

describe("formatValue", () => {
  it("renders sub-1 magnitudes as percentages", () => {
    expect(formatValue(0.253)).toBe("25.3%")
    expect(formatValue(-0.05)).toBe("-5.0%")
  })
  it("keeps zero as 0 (not 0%)", () => {
    expect(formatValue(0)).toBe("0")
  })
  it("abbreviates thousands and millions", () => {
    expect(formatValue(1_234)).toBe("1.2k")
    expect(formatValue(5_600_000)).toBe("5.60M")
  })
  it("rounds and localizes plain integers", () => {
    expect(formatValue(42.4)).toBe("42")
  })
  it("passes strings through and stringifies the rest", () => {
    expect(formatValue("n/a")).toBe("n/a")
    expect(formatValue(Infinity)).toBe("Infinity")
    expect(formatValue({ a: 1 })).toBe('{"a":1}')
  })
})

describe("pickValue", () => {
  it("prefers the requested key, falls back to value", () => {
    expect(pickValue({ conv: 3, value: 9 }, "conv")).toBe(3)
    expect(pickValue({ value: 9 }, "missing")).toBe(9)
    expect(pickValue(null)).toBeUndefined()
  })
})

describe("pickText", () => {
  it("first non-empty of text, list_text, label", () => {
    expect(pickText({ text: "hi" })).toBe("hi")
    expect(pickText({ text: "", list_text: "l1\nl2" })).toBe("l1\nl2")
    expect(pickText({ label: "only label" })).toBe("only label")
    expect(pickText({})).toBeUndefined()
  })
})

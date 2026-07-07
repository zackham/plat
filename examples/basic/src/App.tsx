import { useMemo, useState } from "react"
import { Plat } from "plat"
import "plat/plat.css"
import { makeLocalStorageHost, resetDoc } from "./host"

type Theme = "light" | "dark" | "auto"

export function App() {
  const [theme, setTheme] = useState<Theme>("light")
  const [readOnly, setReadOnly] = useState(false)
  // Remount (key) on reset so the canvas re-loads the seed doc.
  const [epoch, setEpoch] = useState(0)
  const host = useMemo(() => makeLocalStorageHost(), [])

  const dark = theme === "dark"
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "8px 14px",
          borderBottom: "1px solid " + (dark ? "#334155" : "#e2e8f0"),
          background: dark ? "#0f172a" : "#ffffff",
          color: dark ? "#f1f5f9" : "#0f172a",
          fontSize: 14,
        }}
      >
        <strong>plat</strong>
        <span style={{ opacity: 0.6 }}>basic example — localStorage host</span>
        <span style={{ flex: 1 }} />
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          theme
          <select value={theme} onChange={(e) => setTheme(e.target.value as Theme)}>
            <option value="light">light</option>
            <option value="dark">dark</option>
            <option value="auto">auto</option>
          </select>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            checked={readOnly}
            onChange={(e) => setReadOnly(e.target.checked)}
          />
          read-only
        </label>
        <button
          type="button"
          onClick={() => {
            resetDoc()
            setEpoch((n) => n + 1)
          }}
        >
          Reset
        </button>
      </header>
      <Plat key={epoch} host={host} readOnly={readOnly} theme={theme} />
    </div>
  )
}

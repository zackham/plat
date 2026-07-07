import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
  resolve: {
    // plat is consumed as source via the file:../.. link — dedupe so imports
    // inside plat resolve OUR react, not a second copy from plat's dev deps
    // (two React copies silently break context; see HOSTING.md gotcha #1).
    dedupe: ["react", "react-dom", "lucide-react"],
  },
})

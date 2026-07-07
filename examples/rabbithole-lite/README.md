# rabbithole-lite

An homage to **[Rabbithole](https://rabbithole.ing/)** by
[Shlok Khemani](https://github.com/shlokkhemani/rabbithole) — an infinite
canvas for learning where you select any text, ask a question, and the answer
opens as a linked document. Go try the real thing; it's excellent.

This example reimplements Rabbithole's core interaction **on plat** to prove
the platform surface: the entire app is ~350 lines of host code — a custom
`rabbithole.document` node type (streaming markdown, selectable text), a
branch-from-selection toolbar, and a localStorage host. Zero canvas code.
Answers come from a built-in fake generator; swap `fakeAnswer` in
`src/branching.ts` for your LLM / agent / MCP transport and nothing else
changes.

```
npm install
npm run dev
```

Select any text in a card → pick a lens (Explain · ELI5 · Example · Go
deeper) or type a question → the answer streams into a linked child card
(one undo step for the whole stream). Recurse as deep as you like. Dark-mode
toggle in the header; Reset clears localStorage.

What it exercises in plat: `definePlatNodeType`, `platInteractive`,
`usePlatApi` (create/connect/zoomTo), `beginEphemeral`/`endEphemeral`
streaming, `autoHeight` behavior, curve + headless edges, the revision
protocol. See [`NODES.md`](../../NODES.md).

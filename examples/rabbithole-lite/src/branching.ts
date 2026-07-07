// Branch-from-selection: the app-side logic. Creates a child document to the
// right of its parent, links it with a headless curve, streams a fake answer
// into it (one undo step for the whole stream), and glides the camera over.
// A real host would swap `fakeAnswer` for its LLM / agent / MCP transport —
// nothing else changes.

import { createContext } from "react"
import type { PlatApi } from "plat"

export const LENSES = ["Explain", "ELI5", "Example", "Go deeper"] as const

export type BranchFn = (
  fromId: string,
  selection: string,
  lens: string | null,
  question?: string,
) => void

export const BranchContext = createContext<BranchFn | null>(null)

const GAP_X = 160
const GAP_Y = 40

function* fakeAnswer(selection: string, lens: string | null, question?: string) {
  const subject = selection.length > 60 ? selection.slice(0, 57) + "…" : selection
  const intro =
    lens === "ELI5"
      ? `Imagine explaining **${subject}** to a five-year-old:`
      : lens === "Example"
        ? `A concrete example of **${subject}**:`
        : lens === "Go deeper"
          ? `Going deeper on **${subject}**:`
          : question
            ? `You asked: *${question}* — about **${subject}**.`
            : `Let's unpack **${subject}**.`
  const body = [
    `\n\n${intro}\n\n`,
    `This answer is fake — rabbithole-lite ships a generator, not a model. `,
    `In a real host this text would stream from your agent (an LLM, an MCP `,
    `server, your backend — plat doesn't care).\n\n`,
    `What plat IS doing right now:\n\n`,
    `- this card is a **custom node type** the engine has never heard of\n`,
    `- the text you selected lived inside an \`interactive\` region — the\n`,
    `  canvas yielded the pointer to it instead of dragging the card\n`,
    `- these words arrive as \`history:false\` prop patches, so when the\n`,
    `  stream ends the whole answer is **one undo step**\n`,
    `- the edge behind this card is a bound \`curve\` arrow with no head\n\n`,
    `Select any text in this card to keep digging.`,
  ]
  for (const chunk of body) {
    for (const word of chunk.split(/(?<= )/)) yield word
  }
}

export function makeBranch(api: PlatApi): BranchFn {
  return (fromId, selection, lens, question) => {
    const parent = api.getNode(fromId)
    if (!parent || parent.type === "arrow") return

    // stack children below any existing branches of this parent
    const siblings = api
      .getDoc()
      .nodes.filter(
        (n) => n.type === "arrow" && n.start.binding?.nodeId === fromId,
      ).length

    const [child] = api.create(
      {
        type: "rabbithole.document",
        x: parent.x + parent.w + GAP_X,
        y: parent.y + siblings * (200 + GAP_Y),
        w: parent.w,
        props: {
          title: lens ?? question ?? "Answer",
          markdown: "",
          status: "streaming",
          origin: selection,
        },
      },
      { select: true },
    )
    api.connect(fromId, child.id, { kind: "curve", arrowhead: "none" })
    void api.zoomTo(child.id, { animate: 400, padding: 96, maxZoom: 1 })

    // stream the fake answer: many ephemeral patches, ONE undo step
    const words = fakeAnswer(selection, lens, question)
    let acc = ""
    api.beginEphemeral()
    const tick = setInterval(() => {
      let n = 0
      for (const w of [1, 2, 3]) {
        void w
        const next = words.next()
        if (next.done) {
          clearInterval(tick)
          api.updateProps(child.id, { markdown: acc, status: "done" }, { history: false })
          api.endEphemeral()
          return
        }
        acc += next.value
        n++
      }
      if (n) api.updateProps(child.id, { markdown: acc }, { history: false })
    }, 24)
  }
}

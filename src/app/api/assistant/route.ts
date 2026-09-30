import { AssistantError, callClaude, keyStatus, type Block, type Msg } from "@/lib/assistant/claude";
import { createHmac, timingSafeEqual } from "node:crypto";
import { describe, isChange, runTool, type ChangeCard } from "@/lib/assistant/tools";
import { getPushConfig } from "@/lib/push";

export const runtime = "nodejs";
export const maxDuration = 60; // a few back-and-forth lookups can take a while

// The assistant's conversation loop (signed-in users only — see proxy.ts).
//
// POST { messages }                      → a new question (last message = the person's text)
// POST { messages, resume: {results, decision: {id, approve}, sig} }
//                                        → the person answered a Confirm card
//
// Each round: ask Claude → if it wants lookups, run them and ask again → stop
// when it answers, or when it wants to CHANGE something: then reply with a
// `pending` card and wait for Confirm / Cancel. Changes never run without it.
// Returns the updated conversation (the phone keeps it), plus `pending` or
// `changed` (so the app refreshes its list).

const MAX_ROUNDS = 6;
const MAX_HISTORY = 40;

type Pending = { id: string; name: string; input: Record<string, unknown>; card: ChangeCard; results: Block[]; sig: string };

// Every change the assistant proposes is stamped with a signature made from a
// server-only secret. Confirm works only if the signature matches that exact
// change — so a tampered phone or script can't invent a change (or alter one)
// and "confirm" it. (Found by break-testing: a forged change used to go through.)
async function signChange(id: string, name: string, input: unknown): Promise<string> {
  const secret = (await getPushConfig()).runSecret || process.env.CLERK_SECRET_KEY || "";
  if (!secret) throw new AssistantError("The app is missing its signing secret — changes are turned off.");
  return createHmac("sha256", secret).update(`${id}|${name}|${JSON.stringify(input)}`).digest("hex");
}
function sameSig(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// GET → { connected, reason }: whether the assistant really works right now —
// checked with Anthropic (see keyStatus). The key itself never leaves the server.
export async function GET() {
  return Response.json(await keyStatus());
}

export async function POST(req: Request) {
  let body: {
    messages?: Msg[];
    resume?: { results?: Block[]; decision?: { id?: string; approve?: boolean }; sig?: string };
    context?: { okla?: string; building?: string } | null; // the elevator open in the app, if any
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  let messages = Array.isArray(body.messages) ? body.messages : [];
  if (!messages.length) return Response.json({ error: "Nothing to answer" }, { status: 400 });
  // Only the two roles a real chat has — anything else is a hand-made request.
  if (messages.some((m) => m?.role !== "user" && m?.role !== "assistant")) {
    return Response.json({ error: "That chat couldn't be read — start a new chat and try again." }, { status: 400 });
  }
  // Keep each question a sensible size (a pasted wall of text would just run up the Anthropic bill).
  const last = messages[messages.length - 1];
  if (typeof last?.content === "string" && last.content.length > 4000) {
    return Response.json({ error: "That message is too long — please keep it under about 4,000 characters." }, { status: 400 });
  }
  let changed = false;
  const c = body.context;
  const looking =
    c?.okla && c.building ? `${String(c.building).slice(0, 120)} (OK # ${String(c.okla).slice(0, 40)})` : undefined;

  try {
    // The person tapped Confirm or Cancel on a change card.
    if (body.resume) {
      const last = messages[messages.length - 1];
      const uses = Array.isArray(last?.content) ? last.content.filter((b) => b.type === "tool_use") : [];
      const pendingUse = uses.find((u) => u.type === "tool_use" && u.id === body.resume?.decision?.id);
      if (!pendingUse || pendingUse.type !== "tool_use" || !isChange(pendingUse.name)) {
        return Response.json({ error: "That change is no longer waiting." }, { status: 400 });
      }
      let result: Block;
      if (body.resume.decision?.approve) {
        const expected = await signChange(pendingUse.id, pendingUse.name, pendingUse.input);
        if (!sameSig(String(body.resume.sig ?? ""), expected)) {
          return Response.json({ error: "That change wasn't proposed by the assistant, so it wasn't made." }, { status: 400 });
        }
        try {
          const out = await runTool(pendingUse.name, pendingUse.input);
          result = { type: "tool_result", tool_use_id: pendingUse.id, content: JSON.stringify(out) };
          changed = true;
        } catch (e) {
          result = { type: "tool_result", tool_use_id: pendingUse.id, content: errText(e), is_error: true };
        }
      } else {
        result = { type: "tool_result", tool_use_id: pendingUse.id, content: "The person tapped Cancel — nothing was changed." };
      }
      // Answers for every tool call in that message, in the same order.
      const others = (body.resume.results ?? []).filter((b) => b.type === "tool_result");
      const results = uses.map((u) =>
        u.type === "tool_use" && u.id === pendingUse.id ? result : others.find((r) => r.type === "tool_result" && r.tool_use_id === (u as { id: string }).id) ?? skipped((u as { id: string }).id),
      );
      messages = [...messages, { role: "user", content: results }];
    }

    messages = trim(messages);
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const reply = await callClaude(messages, looking);
      messages = [...messages, { role: "assistant", content: reply.content }];
      if (reply.stop_reason !== "tool_use") return Response.json({ messages, changed });

      const results: Block[] = [];
      let pending: Pending | null = null;
      for (const b of reply.content) {
        if (b.type !== "tool_use") continue;
        if (isChange(b.name)) {
          if (pending) results.push(skipped(b.id));
          else {
            let card: ChangeCard;
            try {
              card = await describe(b.name, b.input);
            } catch (e) {
              results.push({ type: "tool_result", tool_use_id: b.id, content: errText(e), is_error: true });
              continue;
            }
            pending = { id: b.id, name: b.name, input: b.input, card, results: [], sig: await signChange(b.id, b.name, b.input) };
          }
          continue;
        }
        try {
          const out = await runTool(b.name, b.input);
          results.push({ type: "tool_result", tool_use_id: b.id, content: JSON.stringify(out).slice(0, 30000) });
        } catch (e) {
          results.push({ type: "tool_result", tool_use_id: b.id, content: errText(e), is_error: true });
        }
      }
      if (pending) {
        pending.results = results;
        return Response.json({ messages, changed, pending });
      }
      messages = [...messages, { role: "user", content: results }];
    }
    return Response.json({
      messages: [...messages, { role: "assistant", content: [{ type: "text", text: "That took more steps than I'm allowed in one go — could you ask again more specifically?" }] }],
      changed,
    });
  } catch (e) {
    if (!(e instanceof AssistantError)) console.error("assistant failed:", e); // shows in the server logs
    const msg = e instanceof AssistantError ? e.message : "Something went wrong reaching the assistant. Try again.";
    return Response.json({ error: msg, messages, changed }, { status: 502 });
  }
}

const errText = (e: unknown) => (e instanceof Error ? e.message : "Failed");
const skipped = (id: string): Block => ({
  type: "tool_result",
  tool_use_id: id,
  content: "Not run — only one change at a time. Ask again for this one after the current change.",
  is_error: true,
});

// Keep the conversation from growing without end: drop the oldest turns, but
// always start on a plain question from the person (never mid-lookup).
function trim(messages: Msg[]): Msg[] {
  if (messages.length <= MAX_HISTORY) return messages;
  let cut = messages.length - MAX_HISTORY;
  while (cut < messages.length && !(messages[cut].role === "user" && typeof messages[cut].content === "string")) cut++;
  return messages.slice(cut);
}

import { SYSTEM_PROMPT } from "@/lib/assistant/prompt";
import { TOOLS } from "@/lib/assistant/tools";

// One call to Anthropic's Messages API with the assistant's tools and
// instructions. The API key is Robert's own. He enters it himself as the
// ANTHROPIC_API_KEY environment variable in the Vercel project settings — the
// app has no screen or endpoint that accepts it, and it never leaves the server.

export const MODEL = process.env.ASSISTANT_MODEL ?? "claude-sonnet-5-5";
// Local testing only: point at a stand-in server with a stand-in key, so the
// loop can be exercised without a real Anthropic account. Ignored on the live site.
const DEV = process.env.NODE_ENV !== "production";
export const API_BASE = (DEV && process.env.ASSISTANT_TEST_BASE) || "https://api.anthropic.com";

export type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };
export type Msg = { role: "user" | "assistant"; content: string | Block[] };

export async function getKey(): Promise<string> {
  if (DEV && process.env.ASSISTANT_TEST_BASE) return "sk-ant-local-test-key";
  return process.env.ANTHROPIC_API_KEY ?? "";
}

// A friendly message for the person when the call fails.
export class AssistantError extends Error {}

// `looking`: the elevator the person has open in the app, if any.
export async function callClaude(messages: Msg[], looking?: string): Promise<{ content: Block[]; stop_reason: string }> {
  const key = await getKey();
  if (!key) throw new AssistantError("The assistant isn't connected yet — the Anthropic key hasn't been added to the app's Vercel settings.");
  const today = new Date().toLocaleDateString("en-US", { timeZone: "America/Chicago", weekday: "long", year: "numeric", month: "long", day: "numeric" });

  const body = JSON.stringify({
    model: MODEL,
    max_tokens: 1500,
    // The instructions + tool list are the same every time → cached (the
    // cache mark on the first block covers the tools too, which come before it).
    system: [
      { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
      { type: "text", text: `Today is ${today} (Oklahoma time).${looking ? ` The person has ${looking} open in the app right now — when they say "it" or "this one", they mean that elevator.` : ""}` },
    ],
    tools: TOOLS,
    messages,
  });

  // One retry when Anthropic is briefly busy (429 / 529 / 5xx).
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API_BASE}/v1/messages`, {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body,
    });
    if (res.ok) return (await res.json()) as { content: Block[]; stop_reason: string };
    if (attempt === 0 && (res.status === 429 || res.status >= 500)) {
      await new Promise((r) => setTimeout(r, 1500));
      continue;
    }
    const detail = ((await res.json().catch(() => ({}))) as { error?: { message?: string } }).error?.message ?? "";
    if (res.status === 401) throw new AssistantError("Anthropic didn't accept the saved key — check the key in the app's Vercel settings.");
    if (res.status === 429) throw new AssistantError("Anthropic says we're over the rate or spending limit. Try again in a minute, or check your Anthropic plan.");
    throw new AssistantError(`The assistant couldn't answer (Anthropic ${res.status}${detail ? `: ${detail}` : ""}).`);
  }
}

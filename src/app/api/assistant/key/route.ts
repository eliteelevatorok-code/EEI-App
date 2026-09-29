import { KEY_NAME, MODEL, getKey } from "@/lib/assistant/claude";
import { writeConfig } from "@/lib/config";

export const runtime = "nodejs";

// The assistant's Anthropic key (signed-in users only — see proxy.ts).
// GET    → { connected, ending, model } — only the last 4 characters, never the key.
// POST   { key } → checks it with Anthropic, then saves it to the Config tab.
// DELETE → removes it (the assistant stops working until a new one is added).

export async function GET() {
  const key = await getKey();
  return Response.json({ connected: Boolean(key), ending: key ? key.slice(-4) : "", model: MODEL });
}

export async function POST(req: Request) {
  let key = "";
  try {
    key = String(((await req.json()) as { key?: string }).key ?? "").trim();
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  if (!/^sk-ant-[\w-]{20,}$/.test(key)) {
    return Response.json({ error: "That doesn't look like an Anthropic key (they start with sk-ant-)." }, { status: 400 });
  }
  // A free check: listing models costs nothing but proves the key works.
  const check = await fetch("https://api.anthropic.com/v1/models?limit=1", {
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
  }).catch(() => null);
  if (!check || check.status === 401 || check.status === 403) {
    return Response.json({ error: "Anthropic didn't accept that key." }, { status: 400 });
  }
  await writeConfig(KEY_NAME, key);
  return Response.json({ connected: true, ending: key.slice(-4), model: MODEL });
}

export async function DELETE() {
  await writeConfig(KEY_NAME, "");
  return Response.json({ connected: false, ending: "", model: MODEL });
}

"use client";

import { useEffect, useRef, useState } from "react";
import { refreshRoster } from "@/lib/roster-store";
import { AskIcon, Button, Glass, Screen, SendIcon, Title, buzz } from "@/components/ui";

// The "Ask" tab: a chat with the assistant (Claude, on Robert's own Anthropic
// key, which lives only in the server's settings on Vercel). The conversation lives on this phone; the server (/api/assistant) does
// the thinking and the lookups. When the assistant wants to change something, a
// Confirm / Cancel card appears here — nothing changes until Confirm is tapped.

type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };
type Msg = { role: "user" | "assistant"; content: string | Block[] };
type Pending = {
  id: string;
  name: string;
  card: { title: string; lines: string[]; danger: boolean };
  results: Block[];
};

const STORAGE_KEY = "eei_chat_v1";
const SUGGESTIONS = [
  "What needs me today?",
  "Who hasn't paid yet?",
  "Which elevators are due in the next 60 days?",
  "Add a note to an elevator",
];

// What the assistant looked at, in plain words (shown as small grey lines).
const LOOKED: Record<string, (i: Record<string, unknown>) => string> = {
  list_elevators: (i) => (i.search ? `Searched the list for “${i.search}”` : "Looked through the elevator list"),
  get_elevator: (i) => `Opened OK # ${i.okla}`,
  get_overview: () => "Checked today's overview",
  get_invoice_balance: (i) => `Checked QuickBooks for OK # ${i.okla}`,
  read_email_wording: () => "Read the email wording",
};

function loadChat(): { messages: Msg[]; pending: Pending | null } {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (saved && Array.isArray(saved.messages)) return { messages: saved.messages, pending: saved.pending ?? null };
  } catch {
    /* ignore */
  }
  return { messages: [], pending: null };
}

export function Assistant() {
  const [chat, setChat] = useState(loadChat);
  const { messages, pending } = chat;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState<boolean | null>(null);
  const [armed, setArmed] = useState(false); // danger changes need a second tap
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/assistant")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { connected?: boolean } | null) => setConnected(Boolean(d?.connected)))
      .catch(() => setConnected(null));
  }, []);

  // Keep the newest message in view.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, busy, pending]);

  function save(next: { messages: Msg[]; pending: Pending | null }) {
    setChat(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* storage full — the chat still works for now */
    }
  }

  async function post(body: unknown, optimistic: Msg[]) {
    setBusy(true);
    setError("");
    setArmed(false);
    save({ messages: optimistic, pending: null });
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        messages?: Msg[];
        pending?: Pending;
        changed?: boolean;
        error?: string;
      };
      if (data.changed) {
        buzz();
        void refreshRoster(); // every tab shows the change
      }
      save({ messages: data.messages ?? optimistic, pending: data.pending ?? null });
      if (!res.ok) setError(data.error || "The assistant couldn't answer. Try again.");
    } catch {
      setError("Couldn't reach the assistant — check your signal and try again.");
    } finally {
      setBusy(false);
    }
  }

  function send(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    setText("");
    const next: Msg[] = [...messages, { role: "user", content: question }];
    void post({ messages: next }, next);
  }

  function decide(approve: boolean) {
    if (!pending || busy) return;
    if (approve && pending.card.danger && !armed) return setArmed(true);
    void post({ messages, resume: { results: pending.results, decision: { id: pending.id, approve } } }, messages);
  }

  // Results by tool-call id, to label each change as saved / cancelled / failed.
  const results = new Map<string, Block & { type: "tool_result" }>();
  for (const m of messages)
    if (Array.isArray(m.content)) for (const b of m.content) if (b.type === "tool_result") results.set(b.tool_use_id, b);

  return (
    <Screen bottomSpace>
      <div className="flex items-end justify-between">
        <Title eyebrow="Your assistant">Ask</Title>
        {messages.length > 0 && (
          <Button variant="quiet" className="text-sm" onClick={() => save({ messages: [], pending: null })} disabled={busy}>
            New chat
          </Button>
        )}
      </div>

      {connected === false && (
        <Glass pad className="mt-6">
          <p className="font-semibold">Connect the assistant</p>
          <p className="mt-1 text-sm text-ink-2">
            It runs on your own Anthropic account. Once your Anthropic key is added to the app&apos;s settings on
            Vercel, this tab is ready.
          </p>
        </Glass>
      )}

      {messages.length === 0 && connected !== false && (
        <div className="mt-6">
          <Glass pad>
            <div className="flex items-center gap-2 font-semibold text-accent-ink">
              <AskIcon /> Ask anything about the business
            </div>
            <p className="mt-1.5 text-sm text-ink-2">
              It can look up any elevator, tell you what needs you, check who&apos;s paid, and make changes to the
              dashboard — you confirm every change before it saves.
            </p>
          </Glass>
          <div className="mt-4 flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button key={s} className="chip glass" onClick={() => (s.startsWith("Add") ? setText(s + " ") : send(s))}>
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6 flex flex-col gap-3 pb-24">
        {messages.map((m, i) =>
          typeof m.content === "string" ? (
            m.role === "user" && (
              <div key={i} className="bubble bubble-me">
                {m.content}
              </div>
            )
          ) : m.role === "assistant" ? (
            <div key={i} className="flex flex-col gap-2">
              {m.content.map((b, j) =>
                b.type === "text" && b.text.trim() ? (
                  <div key={j} className="bubble bubble-ai glass">
                    <Formatted text={b.text} />
                  </div>
                ) : b.type === "tool_use" ? (
                  <div key={j} className="activity px-1">
                    <span className="dot" />
                    {LOOKED[b.name]?.(b.input) ?? changeLabel(results.get(b.id), pending?.id === b.id)}
                  </div>
                ) : null,
              )}
            </div>
          ) : null,
        )}

        {pending && !busy && (
          <Glass pad className={pending.card.danger ? "ring-2 ring-danger/40" : "ring-2 ring-accent/30"}>
            <div className="text-sm font-medium text-ink-2">Confirm this change</div>
            <div className="mt-1 text-lg font-bold tracking-tight">{pending.card.title}</div>
            <ul className="mt-2 flex flex-col gap-1 text-[15px] text-ink-2">
              {pending.card.lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            <div className="mt-4 flex gap-2.5">
              <Button variant="secondary" className="flex-1" onClick={() => decide(false)}>
                Cancel
              </Button>
              <Button variant={pending.card.danger ? "danger" : "primary"} className="flex-1" onClick={() => decide(true)}>
                {pending.card.danger && armed ? "Tap again to confirm" : "Confirm"}
              </Button>
            </div>
          </Glass>
        )}

        {busy && (
          <div className="bubble bubble-ai glass thinking w-fit" aria-label="Thinking">
            <span />
            <span />
            <span />
          </div>
        )}
        {error && <p className="px-1 text-sm font-semibold text-danger">{error}</p>}
        <div ref={endRef} />
      </div>

      <form
        className="composer glass-strong"
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
      >
        <textarea
          rows={1}
          value={text}
          placeholder={pending ? "Or type something else…" : "Ask or tell it what to change…"}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(text);
            }
          }}
          disabled={connected === false}
        />
        <button type="submit" className="icon-btn btn-primary" disabled={busy || !text.trim()} aria-label="Send">
          <SendIcon />
        </button>
      </form>
    </Screen>
  );
}

// The line under a change the assistant asked for: waiting, saved, cancelled or failed.
function changeLabel(result: { content: string; is_error?: boolean } | undefined, waiting: boolean): string {
  if (waiting || !result) return "Waiting for you to confirm a change";
  if (result.content.startsWith("The person tapped Cancel")) return "Change cancelled";
  if (result.is_error) return "Change not made: " + result.content;
  return "Change saved to the dashboard";
}

// Light formatting for replies: **bold**, and lines starting "- " as a list.
function Formatted({ text }: { text: string }) {
  const inline = (s: string) =>
    s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith("**") && p.endsWith("**") ? <strong key={i}>{p.slice(2, -2)}</strong> : p));
  const lines = text.trim().split("\n");
  const out: React.ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length)
      out.push(
        <ul key={out.length} className="my-1 list-disc pl-5">
          {list.map((l, i) => (
            <li key={i}>{inline(l)}</li>
          ))}
        </ul>,
      );
    list = [];
  };
  for (const l of lines) {
    const m = l.match(/^\s*[-•*]\s+(.*)$/);
    if (m) list.push(m[1]);
    else {
      flush();
      if (l.trim()) out.push(<p key={out.length} className="my-0.5">{inline(l)}</p>);
    }
  }
  flush();
  return <>{out}</>;
}

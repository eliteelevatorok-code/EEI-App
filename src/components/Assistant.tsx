"use client";

import { useEffect, useRef, useState } from "react";
import { refreshRoster } from "@/lib/roster-store";
import { AskIcon, Button, Chevron, Glass, SendIcon, buzz } from "@/components/ui";

// The assistant: a round button in the bottom-right of every app screen that
// opens a chat with Claude (on Robert's own Anthropic key, which lives only in
// the server's settings on Vercel). Chats are kept on this phone — start a new
// one any time, or go back to an earlier one from the chat list. The server
// (/api/assistant) does the thinking and the lookups. When the assistant wants
// to change something, a Confirm / Cancel card appears — nothing changes until
// Confirm is tapped.

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
  sig: string; // the server's stamp on this exact change — sent back with Confirm
};
type Chat = { id: string; title: string; updated: number; messages: Msg[]; pending: Pending | null };
type Store = { chats: Chat[]; current: string }; // chats newest first; current may be a new, empty chat

// What the person has open when they tap the button (so "book it for Friday"
// knows which elevator "it" is). null = a list or settings screen.
export type AskContext = { okla: string; building: string } | null;

const STORAGE_KEY = "eei_chats_v2";
const OLD_KEY = "eei_chat_v1"; // the single chat from before the chat list existed
const MAX_CHATS = 30;
const SUGGESTIONS = [
  "What needs me today?",
  "Who hasn't paid yet?",
  "Which elevators are due in the next 60 days?",
  "Add a note to an elevator…",
];

// What the assistant looked at, in plain words (shown as small grey lines).
const LOOKED: Record<string, (i: Record<string, unknown>) => string> = {
  list_elevators: (i) => (i.search ? `Searched the list for “${i.search}”` : "Looked through the elevator list"),
  get_elevator: (i) => `Opened OK # ${i.okla}`,
  get_overview: () => "Checked today's overview",
  get_invoice_balance: (i) => `Checked QuickBooks for OK # ${i.okla}`,
  read_email_wording: () => "Read the email wording",
};

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const blank = (id: string): Chat => ({ id, title: "", updated: Date.now(), messages: [], pending: null });

function loadStore(): Store {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") as Store | null;
    if (saved && Array.isArray(saved.chats)) return saved;
    // Bring over the one chat saved by the earlier version, if any.
    const old = JSON.parse(localStorage.getItem(OLD_KEY) || "null") as { messages?: Msg[]; pending?: Pending } | null;
    if (old?.messages?.length) {
      const c: Chat = { ...blank(newId()), messages: old.messages, pending: old.pending ?? null };
      c.title = titleOf(c.messages);
      return { chats: [c], current: c.id };
    }
  } catch {
    /* ignore */
  }
  return { chats: [], current: newId() };
}

// A chat's name in the list: its first question, shortened.
function titleOf(messages: Msg[]): string {
  const first = messages.find((m) => m.role === "user" && typeof m.content === "string")?.content as string | undefined;
  if (!first) return "New chat";
  return first.length > 60 ? first.slice(0, 57).trimEnd() + "…" : first;
}

// "Just now", "3:40 PM", "Yesterday", "Sep 12".
function when(t: number): string {
  const d = new Date(t);
  const now = new Date();
  if (now.getTime() - t < 60_000) return "Just now";
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

// The round assistant button, floating bottom-right on every app screen.
// `lift` raises it above whatever bar sits at the bottom of that screen.
export function AssistantButton({ context, lift }: { context: AskContext; lift: "tabs" | "bar" | "none" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={"ask-fab btn-primary " + (lift === "tabs" ? "ask-fab-tabs" : lift === "bar" ? "ask-fab-bar" : "")}
        aria-label="Ask the assistant"
      >
        <AskIcon />
      </button>
      {open && <AssistantPanel context={context} onClose={() => setOpen(false)} />}
    </>
  );
}

// The chat pop-up: the current chat, or the list of saved chats.
function AssistantPanel({ context, onClose }: { context: AskContext; onClose: () => void }) {
  const [store, setStore] = useState(loadStore);
  const [view, setView] = useState<"chat" | "list">("chat");
  const chat = store.chats.find((c) => c.id === store.current) ?? blank(store.current);
  const { messages, pending } = chat;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState<boolean | null>(null);
  const [notConnectedWhy, setNotConnectedWhy] = useState("");
  const [armed, setArmed] = useState(false); // danger changes need a second tap
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/assistant")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { connected?: boolean; reason?: string } | null) => {
        setConnected(d ? Boolean(d.connected) : null);
        setNotConnectedWhy(d?.reason ?? "");
      })
      .catch(() => setConnected(null));
  }, []);

  // Keep the newest message in view.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, busy, pending, view]);

  function persist(next: Store) {
    setStore(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* storage full — the chat still works for now */
    }
  }

  // Save the current chat's messages; it moves to the top of the list. A chat
  // with no messages isn't kept in the list.
  function saveChat(id: string, msgs: Msg[], pend: Pending | null) {
    setStore((prev) => {
      const others = prev.chats.filter((c) => c.id !== id);
      const chats = msgs.length
        ? [{ id, title: titleOf(msgs), updated: Date.now(), messages: msgs, pending: pend }, ...others].slice(0, MAX_CHATS)
        : others;
      const next = { ...prev, chats };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  async function post(body: Record<string, unknown>, optimistic: Msg[]) {
    const id = chat.id; // the chat this reply belongs to, even if the person switches away
    setBusy(true);
    setError("");
    setArmed(false);
    saveChat(id, optimistic, null);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, context }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        messages?: Msg[];
        pending?: Pending;
        changed?: boolean;
        error?: string;
      };
      if (data.changed) {
        buzz();
        void refreshRoster(); // every screen shows the change
      }
      saveChat(id, data.messages ?? optimistic, data.pending ?? null);
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
    void post({ messages, resume: { results: pending.results, decision: { id: pending.id, approve }, sig: pending.sig } }, messages);
  }

  const startNew = () => {
    persist({ ...store, current: newId() });
    setError("");
    setText("");
    setView("chat");
  };
  const openChat = (id: string) => {
    persist({ ...store, current: id });
    setError("");
    setView("chat");
  };
  const deleteChat = (id: string) =>
    persist({ chats: store.chats.filter((c) => c.id !== id), current: id === store.current ? newId() : store.current });

  // Results by tool-call id, to label each change as saved / cancelled / failed.
  const results = new Map<string, Block & { type: "tool_result" }>();
  for (const m of messages)
    if (Array.isArray(m.content)) for (const b of m.content) if (b.type === "tool_result") results.set(b.tool_use_id, b);

  const suggestions = context
    ? [`How is ${context.building} doing?`, "Book the visit for…", "Add a note to it…"]
    : SUGGESTIONS;

  return (
    <>
      <div className="scrim" onClick={busy ? undefined : onClose} />
      <div className="sheet glass-strong chat-sheet" role="dialog" aria-modal="true" aria-label="Assistant">
        <div className="sheet-grab" />

        {/* header */}
        <div className="flex items-center justify-between gap-3">
          {view === "list" ? (
            <button onClick={() => setView("chat")} className="btn-quiet flex items-center gap-0.5 text-base">
              <Chevron dir="left" />
              Back
            </button>
          ) : (
            <button onClick={() => setView("list")} className="btn-quiet text-base" disabled={busy}>
              Chats{store.chats.length ? ` (${store.chats.length})` : ""}
            </button>
          )}
          <div className="flex shrink-0 items-center gap-4">
            <Button variant="quiet" className="text-base" onClick={startNew} disabled={busy}>
              New chat
            </Button>
            <Button variant="quiet" className="text-base" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>

        {view === "list" ? (
          <div className="chat-scroll">
            <h3 className="mt-3 text-[21px] font-bold tracking-tight">Your chats</h3>
            {store.chats.length === 0 ? (
              <p className="mt-3 text-[15px] text-ink-3">No saved chats yet.</p>
            ) : (
              <div className="list glass mt-3 overflow-hidden">
                {store.chats.map((c) => (
                  <div key={c.id} className="row">
                    <button onClick={() => openChat(c.id)} className="min-w-0 flex-1 text-left">
                      <div className={"truncate font-semibold " + (c.id === store.current ? "text-accent-ink" : "")}>
                        {c.title || "New chat"}
                      </div>
                      <div className="mt-0.5 text-sm text-ink-3">
                        {when(c.updated)}
                        {c.pending ? " · waiting for you to confirm" : ""}
                      </div>
                    </button>
                    <button onClick={() => deleteChat(c.id)} className="text-sm font-semibold text-danger">
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="mt-3 min-w-0">
              <h3 className="truncate text-[21px] font-bold tracking-tight">{messages.length ? chat.title : "Ask"}</h3>
              {context && <div className="truncate text-sm text-ink-3">Looking at {context.building}</div>}
            </div>

            <div className="chat-scroll">
              {connected === false && (
                <Glass pad className="mt-4">
                  <p className="font-semibold">The assistant isn&apos;t working right now</p>
                  <p className="mt-1 text-sm text-ink-2">
                    {notConnectedWhy || "It runs on your own Anthropic account, using the key in the app's Vercel settings."}
                  </p>
                </Glass>
              )}

              {messages.length === 0 && connected !== false && (
                <div className="mt-4">
                  <p className="text-[15px] text-ink-2">
                    Ask about anything in the business, or tell it what to change — you confirm every change before it
                    saves.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {suggestions.map((s) => (
                      <button key={s} className="chip" onClick={() => (s.endsWith("…") ? setText(s.slice(0, -1) + " ") : send(s))}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-4 flex flex-col gap-3">
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
            </div>

            <form
              className="composer"
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
          </>
        )}
      </div>
    </>
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

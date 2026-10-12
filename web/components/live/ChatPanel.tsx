"use client";

import { useEffect, useRef } from "react";
import Icon from "./Icon";
import type { SidePanel, Turn } from "./types";

const SUGGESTIONS = [
  "Creá un ritual que sume shadow y ego",
  "Leé github.com/gomezlucaspsy/personaforge y resumilo",
  "Armame un updates.txt con mejoras para Young",
];

// Renders ``` fenced blocks as code; everything else as plain wrapped text.
function RichText({ text }: { text: string }) {
  const parts = text.split(/```[a-zA-Z]*\n?/);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <pre key={i} className="my-2 overflow-x-auto rounded-md border border-white/[0.06] bg-black/40 p-3 font-mono text-xs leading-5 text-zinc-300">
            {part.replace(/\n$/, "")}
          </pre>
        ) : (
          <span key={i} className="whitespace-pre-wrap">
            {part}
          </span>
        ),
      )}
    </>
  );
}

type Props = {
  turns: Turn[];
  input: string;
  busy: boolean;
  onInput: (v: string) => void;
  onSend: (text?: string) => void;
  onClear: () => void;
  onOpenFile: (path: string) => void;
  onOpenPanel: (panel: SidePanel) => void;
};

export default function ChatPanel({ turns, input, busy, onInput, onSend, onClear, onOpenFile, onOpenPanel }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between px-4">
        <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
          <Icon name="sparkles" size={13} className="text-violet" /> Oráculo
        </span>
        {turns.length > 0 && (
          <button onClick={onClear} className="rounded px-1.5 py-0.5 text-[11px] text-zinc-500 hover:bg-white/5 hover:text-zinc-300">
            Nueva conversación
          </button>
        )}
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-4 text-[13px] leading-6" aria-live="polite">
        {turns.length === 0 && (
          <div className="space-y-4 pt-6">
            <div>
              <p className="font-[family-name:var(--font-display)] text-base text-zinc-100">Young Oracle</p>
              <p className="mt-1 text-xs leading-5 text-zinc-500">
                Escribe y edita tus rituales .young, lee repos de GitHub y anota mejoras para la app en updates.txt.
              </p>
            </div>
            <div className="space-y-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => onSend(s)}
                  className="flex w-full items-center gap-2 rounded-md border border-white/[0.08] px-3 py-2 text-left text-xs text-zinc-300 hover:border-violet/50 hover:bg-violet/10"
                >
                  <Icon name="sparkles" size={12} className="text-violet" /> {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((t) => {
          if (t.role === "user") {
            return (
              <div key={t.id} className="rounded-md bg-white/[0.05] px-3 py-2 text-zinc-100">
                <span className="whitespace-pre-wrap">{t.text}</span>
              </div>
            );
          }
          if (t.role === "oracle") {
            return (
              <div key={t.id} className="text-zinc-200">
                <RichText text={t.text} />
              </div>
            );
          }
          if (t.role === "error") {
            return (
              <div key={t.id} className="flex items-start gap-2 rounded-md border border-red-900/60 bg-red-950/30 px-3 py-2 text-xs text-red-300">
                <Icon name="alert" size={14} className="mt-1" /> <span className="whitespace-pre-wrap break-words">{t.text}</span>
              </div>
            );
          }
          const clickable = Boolean(t.path || t.panel);
          const body = (
            <>
              <span className={t.pending ? "animate-pulse text-zinc-500" : t.ok ? "text-emerald-400" : "text-red-400"}>
                {t.pending ? "…" : t.ok ? "✓" : "✕"}
              </span>
              <span className="min-w-0 flex-1 truncate">{t.text}</span>
              {clickable && <Icon name="chevron" size={12} className="text-zinc-600" />}
            </>
          );
          return clickable ? (
            <button
              key={t.id}
              onClick={() => (t.path ? onOpenFile(t.path) : t.panel && onOpenPanel(t.panel))}
              className="flex w-full items-center gap-2 rounded px-2 py-1 text-left font-mono text-[11px] text-zinc-400 hover:bg-white/5"
              title={t.text}
            >
              {body}
            </button>
          ) : (
            <div key={t.id} className="flex items-center gap-2 px-2 py-1 font-mono text-[11px] text-zinc-500" title={t.text}>
              {body}
            </div>
          );
        })}

        {busy && (
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet" /> El Oráculo está pensando…
          </div>
        )}
      </div>

      <div className="shrink-0 p-3 pt-0">
        <div className="rounded-lg border border-white/10 bg-black/30 focus-within:border-violet/70">
          <textarea
            id="oracle-input"
            value={input}
            onChange={(e) => onInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
            rows={2}
            placeholder="Pedile algo al Oráculo…"
            aria-label="Mensaje para el Oráculo"
            className="block max-h-40 w-full resize-none bg-transparent px-3 pt-2 text-[13px] outline-none placeholder:text-zinc-600"
          />
          <div className="flex items-center justify-between px-2 pb-1.5">
            <span className="text-[10px] text-zinc-600">Enter envía · Shift+Enter nueva línea</span>
            <button
              onClick={() => onSend()}
              disabled={busy || !input.trim()}
              aria-label="Enviar"
              className="rounded-md bg-violet p-1.5 text-white hover:brightness-110 disabled:bg-white/10 disabled:text-zinc-500"
            >
              <Icon name="send" size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

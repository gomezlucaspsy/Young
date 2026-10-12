"use client";

import { useState } from "react";
import { buildUpdatesPdf, newRequestLines, parseUpdateItems, UPDATES_FILE } from "@/lib/updates";
import Icon from "./Icon";
import type { UpdatesConfig } from "./types";

// Requests already handed to GitHub from this browser, so "Enviar" only ever
// sends what's new (the bot implements every line of each new file).
const SENT_KEY = "young:updatesSent";

function readSent(): string {
  try {
    return localStorage.getItem(SENT_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeSent(text: string) {
  try {
    localStorage.setItem(SENT_KEY, text);
  } catch {}
}

function download(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadUpdates(content: string, format: "txt" | "pdf") {
  if (format === "txt") download(UPDATES_FILE, content, "text/plain;charset=utf-8");
  else download("updates.pdf", buildUpdatesPdf("Young - updates", content) as BlobPart, "application/pdf");
}

// GitHub's "new file" page accepts filename/value/message in the query string,
// so sending needs no token or server: the owner, already signed in to GitHub,
// just presses "Commit changes", and that push triggers updates-to-pr.yml.
function githubNewFileUrl(repo: string, lines: string[]): string {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "").replace(/^(\d{8})/, "$1-");
  const params = new URLSearchParams({
    filename: `updates/updates-${stamp}.txt`,
    value: `${lines.join("\n")}\n`,
    message: `updates: ${lines.length} pedido(s) desde Young Live`,
  });
  return `https://github.com/${repo}/new/main?${params.toString()}`;
}

type Props = {
  content: string | null; // null = updates.txt doesn't exist yet
  config: UpdatesConfig | null;
  onOpenFile: () => void;
  onCreateEmpty: () => void;
  onAskOracle: (prompt: string) => void;
  onToast: (text: string, ok?: boolean) => void;
};

export default function UpdatesPanel({ content, config, onOpenFile, onCreateEmpty, onAskOracle, onToast }: Props) {
  const [sent, setSent] = useState(readSent);
  const [justSent, setJustSent] = useState(0);

  const repo = config?.repo ?? "gomezlucaspsy/Young";
  const items = content ? parseUpdateItems(content) : [];
  const toSend = content ? newRequestLines(sent, content) : [];

  function sendToGithub() {
    if (!toSend.length) return;
    window.open(githubNewFileUrl(repo, toSend), "_blank", "noopener");
    const next = `${sent}${toSend.join("\n")}\n`;
    writeSent(next);
    setSent(next);
    setJustSent(toSend.length);
  }

  function resendAll() {
    writeSent("");
    setSent("");
    setJustSent(0);
    onToast("Listo: podés volver a enviar todos los pedidos");
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 items-center px-4">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Updates</span>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden px-4 pb-4 text-xs leading-5">
        <p className="text-zinc-400">
          Pedidos de cambios para la app. El Oráculo los anota en <code className="text-gold">{UPDATES_FILE}</code>; vos
          los mandás y un bot abre un pull request.
        </p>

        <ol className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[10px] uppercase tracking-wider text-zinc-500" aria-label="Flujo">
          {["Enviar", "Claude implementa", "CodeRabbit revisa", "Vos mergeás"].map((step, i) => (
            <li key={step} className="flex items-center gap-1 whitespace-nowrap">
              {i > 0 && <Icon name="chevron" size={10} className="text-zinc-700" />}
              <span className={i === 0 ? "text-gold" : ""}>{step}</span>
            </li>
          ))}
        </ol>

        {content === null ? (
          <div className="space-y-2 rounded-md border border-dashed border-white/10 p-3">
            <p className="text-zinc-400">Todavía no hay pedidos.</p>
            <button
              onClick={() => onAskOracle("Armame un updates.txt con 3 mejoras concretas para Young.")}
              className="flex w-full items-center justify-center gap-2 rounded bg-violet px-3 py-1.5 font-medium text-white hover:brightness-110"
            >
              <Icon name="sparkles" size={14} /> Pedíselo al Oráculo
            </button>
            <button onClick={onCreateEmpty} className="w-full rounded border border-white/10 px-3 py-1.5 text-zinc-300 hover:bg-white/5">
              Escribirlo yo
            </button>
          </div>
        ) : (
          <>
            <button onClick={onOpenFile} className="w-full rounded-md border border-white/10 text-left hover:border-white/20">
              <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-1.5 text-[11px] text-zinc-500">
                <span>
                  {toSend.length} sin enviar · {items.length} en total
                </span>
                <span className="text-zinc-400">Editar</span>
              </div>
              <ul className="max-h-56 space-y-1 overflow-y-auto px-3 py-2">
                {items.length === 0 && <li className="text-zinc-600">(vacío)</li>}
                {items.map((item, i) => (
                  <li key={i} className={`flex gap-2 ${item.done ? "text-zinc-600 line-through" : "text-zinc-300"}`}>
                    <span className={item.done ? "text-emerald-500" : "text-zinc-600"}>{item.done ? "✓" : "○"}</span>
                    <span>{item.text}</span>
                  </li>
                ))}
              </ul>
            </button>

            <button
              onClick={sendToGithub}
              disabled={toSend.length === 0}
              className="flex w-full items-center justify-center gap-2 rounded bg-violet px-3 py-2 font-medium text-white hover:brightness-110 disabled:opacity-50"
            >
              <Icon name="send" size={14} />
              {toSend.length === 0 ? "Todo enviado" : `Enviar ${toSend.length} a GitHub`}
            </button>

            {justSent > 0 && (
              <div className="space-y-1.5 rounded-md border border-emerald-900/60 bg-emerald-950/30 p-3 text-emerald-200">
                <p className="flex items-start gap-2">
                  <Icon name="check" size={14} className="mt-0.5" />
                  <span>
                    Se abrió GitHub con {justSent} pedido(s). Tocá el botón verde <b>Commit changes</b> y listo: el PR
                    aparece en unos minutos.
                  </span>
                </p>
                {config && (
                  <div className="flex gap-3 pl-6 text-emerald-300/80">
                    <a href={config.actionsUrl} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
                      Ver progreso
                    </a>
                    <a href={config.pullsUrl} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
                      Ver PRs
                    </a>
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-2 border-t border-white/[0.06] pt-3">
              <button
                onClick={() => downloadUpdates(content, "txt")}
                className="flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1 text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
              >
                <Icon name="download" size={13} /> .txt
              </button>
              <button
                onClick={() => downloadUpdates(content, "pdf")}
                className="flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1 text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
              >
                <Icon name="download" size={13} /> .pdf
              </button>
              <button
                onClick={() => onAskOracle("Revisá updates.txt y sumá lo que falte para que Young sea más fácil de usar.")}
                className="flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1 text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
              >
                <Icon name="sparkles" size={13} /> Ampliar
              </button>
            </div>
            {sent && (
              <button onClick={resendAll} className="text-[11px] text-zinc-600 underline-offset-2 hover:text-zinc-400 hover:underline">
                ¿No llegaste a commitear? Volver a enviar todo
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

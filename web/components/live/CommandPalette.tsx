"use client";

import { useState } from "react";
import Icon, { type IconName } from "./Icon";

export type Command = { id: string; label: string; hint?: string; icon: IconName; run: () => void };

export default function CommandPalette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);

  const q = query.trim().toLowerCase();
  const filtered = q ? commands.filter((c) => c.label.toLowerCase().includes(q)) : commands;
  const selected = Math.min(index, Math.max(filtered.length - 1, 0));

  function runAt(i: number) {
    const cmd = filtered[i];
    if (!cmd) return;
    onClose();
    cmd.run();
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-black/40 px-4 pt-[12vh]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label="Paleta de comandos"
        className="h-fit w-full max-w-lg overflow-hidden rounded-lg border border-white/10 bg-[#14121c] shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-white/[0.08] px-3">
          <Icon name="search" size={15} className="text-zinc-500" />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              else if (e.key === "ArrowDown") {
                e.preventDefault();
                setIndex((selected + 1) % Math.max(filtered.length, 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((selected - 1 + filtered.length) % Math.max(filtered.length, 1));
              } else if (e.key === "Enter") runAt(selected);
            }}
            placeholder="Escribí un comando o el nombre de un archivo…"
            aria-label="Buscar comando"
            className="h-11 flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-600"
          />
        </div>
        <ul className="max-h-80 overflow-y-auto py-1" role="listbox">
          {filtered.length === 0 && <li className="px-4 py-3 text-xs text-zinc-500">Sin resultados</li>}
          {filtered.map((c, i) => (
            <li key={c.id} role="option" aria-selected={i === selected}>
              <button
                onMouseEnter={() => setIndex(i)}
                onClick={() => runAt(i)}
                className={`flex w-full items-center gap-3 px-4 py-2 text-left text-[13px] ${
                  i === selected ? "bg-violet/25 text-zinc-50" : "text-zinc-300"
                }`}
              >
                <Icon name={c.icon} size={14} className="text-zinc-400" />
                <span className="flex-1 truncate">{c.label}</span>
                {c.hint && <kbd className="font-mono text-[11px] text-zinc-500">{c.hint}</kbd>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

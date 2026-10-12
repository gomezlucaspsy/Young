"use client";

import { useRef } from "react";
import Icon from "./Icon";

type Props = {
  tabs: { path: string; name: string; dirty: boolean }[];
  activePath: string | null;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onDownload: () => void;
  onSelectTab: (path: string) => void;
  onCloseTab: (path: string) => void;
  onAskOracle: (prompt: string) => void;
  welcome: React.ReactNode;
};

export default function Editor({ tabs, activePath, value, onChange, onSave, onDownload, onSelectTab, onCloseTab, onAskOracle, welcome }: Props) {
  const gutterRef = useRef<HTMLDivElement>(null);
  const active = tabs.find((t) => t.path === activePath) ?? null;
  const lineCount = value.split("\n").length;

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      const el = e.currentTarget;
      el.setRangeText("    ", el.selectionStart, el.selectionEnd, "end");
      onChange(el.value);
    }
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#0d0c13]">
      {tabs.length > 0 && (
        <div className="flex h-9 shrink-0 overflow-x-auto border-b border-white/[0.06] bg-[#0a0910]" role="tablist">
          {tabs.map((t) => {
            const isActive = t.path === activePath;
            return (
              <div
                key={t.path}
                role="tab"
                aria-selected={isActive}
                className={`group flex shrink-0 items-center gap-2 border-r border-white/[0.06] pl-3 pr-1 text-[13px] ${
                  isActive ? "border-t border-t-violet bg-[#0d0c13] text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                <button onClick={() => onSelectTab(t.path)} className="py-2">
                  {t.name}
                </button>
                <button
                  onClick={() => onCloseTab(t.path)}
                  aria-label={`Cerrar ${t.name}`}
                  title={t.dirty ? "Sin guardar — cerrar descarta los cambios" : "Cerrar"}
                  className="flex h-5 w-5 items-center justify-center rounded hover:bg-white/10"
                >
                  {t.dirty ? (
                    <>
                      <span className="h-2 w-2 rounded-full bg-zinc-300 group-hover:hidden" />
                      <Icon name="x" size={13} className="hidden group-hover:block" />
                    </>
                  ) : (
                    <Icon name="x" size={13} className={isActive ? "" : "opacity-0 group-hover:opacity-100"} />
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {active ? (
        <>
          <div className="flex h-8 shrink-0 items-center justify-between gap-2 px-4 text-xs text-zinc-500">
            <span className="truncate">
              MyComputer <span className="px-1 text-zinc-700">›</span> <span className="text-zinc-300">{active.name}</span>
            </span>
            <div className="flex shrink-0 items-center gap-1">
              <button
                onClick={() => onAskOracle(`Explicame ${active.name} y sugerí una mejora.`)}
                className="flex items-center gap-1.5 rounded px-2 py-1 hover:bg-white/5 hover:text-zinc-200"
              >
                <Icon name="sparkles" size={13} /> Preguntar al Oráculo
              </button>
              <button
                onClick={onDownload}
                title={`Descargar ${active.name}`}
                className="flex items-center gap-1.5 rounded px-2 py-1 hover:bg-white/5 hover:text-zinc-200"
              >
                <Icon name="download" size={13} /> Descargar
              </button>
              <button
                onClick={onSave}
                disabled={!active.dirty}
                title="Guardar (Ctrl+S)"
                className="flex items-center gap-1.5 rounded px-2 py-1 hover:bg-white/5 hover:text-zinc-200 disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <Icon name="save" size={13} /> Guardar
              </button>
            </div>
          </div>
          <div className="flex min-h-0 flex-1 font-mono text-[13px] leading-6">
            <div
              ref={gutterRef}
              aria-hidden="true"
              className="select-none overflow-hidden py-2 pl-4 pr-3 text-right text-zinc-600"
            >
              {Array.from({ length: lineCount }, (_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
            </div>
            <textarea
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={onKeyDown}
              onScroll={(e) => {
                if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop;
              }}
              spellCheck={false}
              aria-label={`Contenido de ${active.name}`}
              className="min-h-0 flex-1 resize-none whitespace-pre bg-transparent py-2 pr-4 text-zinc-200 outline-none"
            />
          </div>
        </>
      ) : (
        welcome
      )}
    </div>
  );
}

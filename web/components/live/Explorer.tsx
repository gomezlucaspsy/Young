"use client";

import { useState } from "react";
import type { FsListItem } from "@/lib/virtual-fs";
import { UPDATES_FILE } from "@/lib/updates";
import Icon from "./Icon";

type Props = {
  files: FsListItem[];
  activePath: string | null;
  dirtyPaths: Set<string>;
  onOpen: (path: string) => void;
  onCreate: (name: string) => string | null; // returns an error message, or null on success
  onDelete: (path: string) => void;
  onDownload: (path: string) => void;
  onAskOracle: (prompt: string) => void;
  creating: boolean;
  setCreating: (v: boolean) => void;
  folderName: string | null;
  pendingFolderName: string | null;
  onOpenFolder: () => void;
};

export default function Explorer({ files, activePath, dirtyPaths, onOpen, onCreate, onDelete, onDownload, onAskOracle, creating, setCreating, folderName, pendingFolderName, onOpenFolder }: Props) {
  const [newName, setNewName] = useState("");
  const [createError, setCreateError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  function submitCreate() {
    let name = newName.trim();
    if (!name) {
      setCreating(false);
      return;
    }
    if (!name.includes(".")) name += ".young";
    const err = onCreate(name);
    if (err) {
      setCreateError(err);
      return;
    }
    setCreating(false);
    setNewName("");
    setCreateError("");
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 items-center justify-between px-4">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">MyComputer</span>
        <button
          onClick={() => {
            setCreating(true);
            setCreateError("");
          }}
          title="Nuevo archivo"
          aria-label="Nuevo archivo"
          className="rounded p-1 text-zinc-400 hover:bg-white/10 hover:text-zinc-100"
        >
          <Icon name="plus" size={15} />
        </button>
      </div>

      <div className="px-2 pb-2">
        {folderName ? (
          <div className="flex items-center gap-2 rounded bg-emerald-950/30 px-2 py-1.5 text-xs text-emerald-200" title="Los cambios se guardan también en esta carpeta">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            <span className="truncate">Carpeta: {folderName}</span>
          </div>
        ) : (
          <button
            onClick={onOpenFolder}
            className="flex w-full items-center gap-2 rounded border border-white/10 px-2 py-1.5 text-left text-xs text-zinc-300 hover:bg-white/5"
          >
            <Icon name="files" size={13} className="text-gold" />
            <span className="truncate">{pendingFolderName ? `Reabrir carpeta ${pendingFolderName}` : "Abrir carpeta de mi PC"}</span>
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-2" role="tree" aria-label="Archivos">
        {creating && (
          <div className="px-2 pb-1">
            <input
              autoFocus
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
                setCreateError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitCreate();
                if (e.key === "Escape") setCreating(false);
              }}
              onBlur={() => !newName.trim() && setCreating(false)}
              placeholder="nombre.young"
              aria-label="Nombre del archivo nuevo"
              className="w-full rounded border border-violet/70 bg-black/40 px-2 py-1 font-mono text-xs outline-none"
            />
            <p className={`mt-1 px-1 text-[11px] ${createError ? "text-red-400" : "text-zinc-500"}`}>
              {createError || "Enter para crear · Esc para cancelar"}
            </p>
          </div>
        )}

        {files.map((f) => {
          const active = f.path === activePath;
          const isUpdates = f.name === UPDATES_FILE;
          if (confirmDelete === f.path) {
            return (
              <div key={f.path} className="mx-2 flex items-center gap-2 rounded bg-red-950/40 px-2 py-1 text-xs">
                <span className="flex-1 truncate text-red-300">¿Borrar {f.name}?</span>
                <button
                  autoFocus
                  onClick={() => {
                    onDelete(f.path);
                    setConfirmDelete(null);
                  }}
                  className="rounded bg-red-500/80 px-2 py-0.5 font-medium text-white hover:bg-red-500"
                >
                  Borrar
                </button>
                <button onClick={() => setConfirmDelete(null)} className="px-1 text-zinc-400 hover:text-zinc-100">
                  No
                </button>
              </div>
            );
          }
          return (
            <div
              key={f.path}
              role="treeitem"
              aria-selected={active}
              className={`group flex items-center ${active ? "bg-violet/20 text-zinc-50" : "text-zinc-300 hover:bg-white/5"}`}
            >
              <button onClick={() => onOpen(f.path)} className="flex min-w-0 flex-1 items-center gap-2 py-1 pl-4 text-left">
                <span className={`font-mono text-[10px] ${isUpdates ? "text-gold" : "text-violet"}`}>{isUpdates ? "TXT" : "YG"}</span>
                <span className="truncate">{f.name}</span>
                {dirtyPaths.has(f.path) && <span className="h-1.5 w-1.5 rounded-full bg-zinc-300" title="Sin guardar" />}
              </button>
              <button
                onClick={() => onDownload(f.path)}
                title={`Descargar ${f.name}`}
                aria-label={`Descargar ${f.name}`}
                className="rounded p-1 text-zinc-500 opacity-0 hover:text-zinc-100 focus:opacity-100 group-hover:opacity-100"
              >
                <Icon name="download" size={13} />
              </button>
              <button
                onClick={() => setConfirmDelete(f.path)}
                title={`Borrar ${f.name}`}
                aria-label={`Borrar ${f.name}`}
                className="mr-2 rounded p-1 text-zinc-500 opacity-0 hover:text-red-400 focus:opacity-100 group-hover:opacity-100"
              >
                <Icon name="trash" size={13} />
              </button>
            </div>
          );
        })}

        {files.length === 0 && !creating && (
          <div className="space-y-3 px-4 py-3 text-xs leading-5 text-zinc-500">
            <p>Todavía no hay archivos. Tus rituales .young viven en este navegador.</p>
            <button onClick={() => setCreating(true)} className="flex w-full items-center justify-center gap-2 rounded bg-violet px-3 py-1.5 font-medium text-white hover:brightness-110">
              <Icon name="plus" size={14} /> Nuevo archivo
            </button>
            <button
              onClick={() => onAskOracle("Creá un ritual de ejemplo que integre shadow y ego, y explicámelo en dos líneas.")}
              className="flex w-full items-center justify-center gap-2 rounded border border-white/10 px-3 py-1.5 text-zinc-300 hover:bg-white/5"
            >
              <Icon name="sparkles" size={14} /> Que lo escriba el Oráculo
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

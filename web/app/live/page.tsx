"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  fsApplyAction,
  fsList,
  fsLoad,
  fsSave,
  fsTree,
  type FsListItem,
} from "@/lib/virtual-fs";
import {
  deleteFolderFile,
  folderAccessSupported,
  pickFolder,
  readFolder,
  regrantFolder,
  restoreFolder,
  writeFolderFile,
  type DirHandle,
} from "@/lib/local-folder";

type Turn = { role: "user" | "oracle" | "system" | "error"; text: string };

type AgentSnapshot = { agentId: string; label: string; status: "online" | "offline" } | null;

function randomAgentId(): string {
  return `young-${Math.random().toString(36).slice(2, 8)}`;
}

function useAgentId(): string {
  const [id, setId] = useState("");
  useEffect(() => {
    try {
      const existing = localStorage.getItem("young:agentId");
      if (existing) {
        setId(existing);
        return;
      }
      const created = randomAgentId();
      localStorage.setItem("young:agentId", created);
      setId(created);
    } catch {
      setId(randomAgentId());
    }
  }, []);
  return id;
}

async function pollCommand(commandId: string, onDone: (result: string, ok: boolean) => void) {
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const res = await fetch(`/api/agent/status?commandId=${encodeURIComponent(commandId)}`);
      if (!res.ok) continue;
      const data = await res.json();
      const status = data?.command?.status;
      if (status === "completed" || status === "failed") {
        onDone(data.command.result || "(no result)", status === "completed");
        return;
      }
    } catch {
      // network hiccup — keep polling
    }
  }
  onDone("(timed out waiting for Host Agent)", false);
}

export default function LivePage() {
  const agentId = useAgentId();
  const [agentStatus, setAgentStatus] = useState<AgentSnapshot>(null);
  const [folder, setFolder] = useState<DirHandle | null>(null);
  // A folder granted on a previous visit that the browser wants re-confirmed.
  const [pendingFolder, setPendingFolder] = useState<DirHandle | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [turns, setTurns] = useState<Turn[]>([
    { role: "system", text: "Young Oracle — Web Live. .young files here live only in this browser." },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<FsListItem[]>([]);
  const [selected, setSelected] = useState<FsListItem | null>(null);
  const [editorText, setEditorText] = useState("");
  const transcriptRef = useRef<HTMLDivElement>(null);

  const refreshFiles = useCallback(() => setFiles(fsList(fsLoad())), []);
  useEffect(() => refreshFiles(), [refreshFiles]);

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight });
  }, [turns]);

  // Poll agent presence every 5s so the UI (and the next chat call) knows
  // whether PC_ACTION is currently usable.
  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/agent/status");
        if (!res.ok) return;
        const data = await res.json();
        const mine = (data.agents ?? []).find((a: { agentId: string }) => a.agentId === agentId);
        if (!cancelled) setAgentStatus(mine ?? { agentId, label: agentId, status: "offline" });
      } catch {
        if (!cancelled) setAgentStatus({ agentId, label: agentId, status: "offline" });
      }
    };
    tick();
    const t = setInterval(tick, 5000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [agentId]);

  const append = (turn: Turn) => setTurns((prev) => [...prev, turn]);

  // Disk wins on connect: the folder's .young files are merged into the
  // browser copy, and from then on every change is mirrored back to disk.
  const importFromDisk = useCallback(
    async (handle: DirHandle) => {
      const disk = await readFolder(handle);
      fsSave({ ...fsLoad(), ...disk });
      refreshFiles();
      setFolder(handle);
      setPendingFolder(null);
      setTurns((prev) => [
        ...prev,
        { role: "system", text: `Carpeta "${handle.name}" conectada (${Object.keys(disk).length} archivos .young).` },
      ]);
    },
    [refreshFiles],
  );

  useEffect(() => {
    restoreFolder().then((saved) => {
      if (!saved) return;
      if (saved.granted) importFromDisk(saved.handle);
      else setPendingFolder(saved.handle);
    });
  }, [importFromDisk]);

  async function requestFileAccess() {
    try {
      if (pendingFolder && (await regrantFolder(pendingFolder))) return importFromDisk(pendingFolder);
      if (folderAccessSupported()) return importFromDisk(await pickFolder());
      fileInputRef.current?.click();
    } catch (err) {
      if ((err as DOMException)?.name !== "AbortError") append({ role: "error", text: String(err) });
    }
  }

  // Android / Firefox / Safari: no folder access, so import via the OS picker.
  async function importPickedFiles(list: FileList | null) {
    let fs = fsLoad();
    let n = 0;
    for (const file of Array.from(list ?? [])) {
      if (!file.name.toLowerCase().endsWith(".young")) continue;
      const path = `/${file.name}`;
      const now = new Date().toISOString();
      fs = { ...fs, [path]: { type: "file", content: await file.text(), created: fs[path]?.created ?? now, modified: now } };
      n++;
    }
    fsSave(fs);
    refreshFiles();
    append({ role: "system", text: `${n} archivo(s) .young importados.` });
  }

  function syncToDisk(name: string, content: string | null) {
    if (!folder) return;
    const clean = name.trim().replace(/^\/+/, "");
    (content === null ? deleteFolderFile(folder, clean) : writeFolderFile(folder, clean, content)).catch((err) =>
      append({ role: "error", text: `No se pudo guardar ${clean} en la carpeta: ${err}` }),
    );
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    append({ role: "user", text });
    setBusy(true);

    try {
      const history = [...turns.filter((t) => t.role === "user" || t.role === "oracle"), { role: "user" as const, text }];
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: history.map((t) => ({ role: t.role === "oracle" ? "assistant" : "user", text: t.text })),
          filesTree: fsTree(fsLoad()),
          agentId,
          agentOnline: agentStatus?.status === "online",
        }),
      });
      const data = await res.json();

      if (data.error) {
        append({ role: "error", text: String(data.error) });
        return;
      }

      // Apply FILE_ACTIONs to the browser sandbox immediately.
      for (const action of data.fileActions ?? []) {
        const { fs, result } = fsApplyAction(fsLoad(), action);
        fsSave(fs);
        append({ role: "system", text: `${action.action.toUpperCase()} -> ${result}` });
        if (result.startsWith("OK") && action.name) {
          if (action.action === "delete") syncToDisk(action.name, null);
          else if (action.action === "create" || action.action === "update") syncToDisk(action.name, action.content ?? "");
        }
        if (action.action === "delete") {
          setSelected((prev) => (prev && prev.name === (action.name ?? "").trim() ? null : prev));
        }
      }
      refreshFiles();

      // read_repo resolves server-side within the same request — just log it.
      for (const repoAction of data.repoActions ?? []) {
        append({ role: "system", text: `read_repo(${repoAction.param}) -> ${repoAction.summary}` });
      }

      append({ role: "oracle", text: data.reply || "(no response)" });

      // PC_ACTIONs resolve asynchronously via the Host Agent's poll loop.
      for (const pc of data.pcActions ?? []) {
        if (!pc.commandId) {
          append({ role: "error", text: pc.error || `PC_ACTION "${pc.type}" could not be queued` });
          continue;
        }
        append({ role: "system", text: `queued ${pc.type}(${pc.param || "-"}) for Host Agent, waiting...` });
        pollCommand(pc.commandId, (result, ok) => {
          append({ role: "system", text: `${pc.type}(${pc.param || "-"}) -> ${ok ? result : `ERROR: ${result}`}` });
        });
      }
    } catch (err) {
      append({ role: "error", text: String(err) });
    } finally {
      setBusy(false);
    }
  }

  function openFile(item: FsListItem) {
    setSelected(item);
    setEditorText(item.content);
  }

  function saveFile() {
    if (!selected) return;
    const { fs, result } = fsApplyAction(fsLoad(), {
      action: "update",
      path: "/",
      name: selected.name,
      content: editorText,
    });
    fsSave(fs);
    if (result.startsWith("OK")) syncToDisk(selected.name, editorText);
    refreshFiles();
    append({ role: "system", text: result });
  }

  function createFile() {
    const name = prompt("New file name (must end in .young):", "untitled.young");
    if (!name) return;
    const { fs, result } = fsApplyAction(fsLoad(), { action: "create", path: "/", name, content: "" });
    fsSave(fs);
    if (result.startsWith("OK")) syncToDisk(name, "");
    refreshFiles();
    append({ role: "system", text: result });
  }

  function deleteFile(item: FsListItem, e?: React.MouseEvent) {
    e?.stopPropagation();
    if (!confirm(`Borrar ${item.name}?`)) return;
    const { fs, result } = fsApplyAction(fsLoad(), { action: "delete", path: "/", name: item.name });
    fsSave(fs);
    if (result.startsWith("OK")) syncToDisk(item.name, null);
    if (selected?.path === item.path) {
      setSelected(null);
      setEditorText("");
    }
    refreshFiles();
    append({ role: "system", text: result });
  }

  return (
    <div className="flex-1 bg-radial-glow">
      <div className="mx-auto flex h-screen max-w-6xl flex-col px-6 py-8 sm:px-8">
        <header className="flex items-center justify-between">
          <Link href="/" className="font-[family-name:var(--font-display)] text-sm tracking-[0.3em] text-gold">
            YOUNG
          </Link>
          <div className="flex items-center gap-4 text-xs text-zinc-500">
            {agentStatus?.status === "online" && (
              <span className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-400" /> PC conectada
              </span>
            )}
            {folder ? (
              <span className="text-zinc-300">Carpeta: {folder.name}</span>
            ) : (
              <button onClick={requestFileAccess} className="text-gold hover:underline">
                {pendingFolder ? `Reconectar carpeta ${pendingFolder.name}` : "Dar acceso a mis archivos"}
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".young"
              multiple
              hidden
              onChange={(e) => {
                importPickedFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
        </header>

        <div className="mt-6 grid flex-1 grid-cols-1 gap-4 overflow-hidden md:grid-cols-[1fr_260px]">
          <div className="flex flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/40">
            <div ref={transcriptRef} className="flex-1 space-y-2 overflow-y-auto p-4 text-sm">
              {turns.map((t, i) => (
                <div
                  key={i}
                  className={
                    t.role === "user"
                      ? "text-zinc-100"
                      : t.role === "oracle"
                        ? "text-violet"
                        : t.role === "error"
                          ? "text-red-400"
                          : "text-zinc-500"
                  }
                >
                  <span className="mr-2 text-xs uppercase tracking-wider opacity-60">
                    {t.role === "user" ? "vos" : t.role === "oracle" ? "oráculo" : t.role === "error" ? "error" : "sistema"}
                  </span>
                  <span className="whitespace-pre-wrap">{t.text}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-2 border-t border-zinc-800 p-3">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
                placeholder="Pedile algo al Oráculo…"
                className="flex-1 rounded-md border border-zinc-800 bg-black/40 px-3 py-2 text-sm outline-none focus:border-violet"
              />
              <button
                onClick={send}
                disabled={busy}
                className="rounded-md bg-violet px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {busy ? "…" : "Enviar"}
              </button>
            </div>
          </div>

          <div className="flex flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/40">
            <div className="flex items-center justify-between border-b border-zinc-800 p-3">
              <span className="text-xs uppercase tracking-wider text-zinc-500">MyComputer</span>
              <button onClick={createFile} className="text-xs text-gold hover:underline">
                + nuevo
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 text-sm">
              {files.length === 0 && <p className="p-2 text-xs text-zinc-600">Sin archivos aún.</p>}
              {files.map((f) => (
                <div
                  key={f.path}
                  className={`flex items-center gap-1 rounded ${
                    selected?.path === f.path ? "bg-violet/20 text-violet" : "text-zinc-300 hover:bg-zinc-900"
                  }`}
                >
                  <button onClick={() => openFile(f)} className="flex-1 truncate px-2 py-1 text-left">
                    {f.name}
                  </button>
                  <button
                    onClick={(e) => deleteFile(f, e)}
                    title="Borrar"
                    className="px-2 py-1 text-xs text-zinc-600 hover:text-red-400"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            {selected && (
              <div className="border-t border-zinc-800 p-2">
                <textarea
                  value={editorText}
                  onChange={(e) => setEditorText(e.target.value)}
                  rows={8}
                  className="w-full rounded-md border border-zinc-800 bg-black/40 p-2 font-mono text-xs outline-none"
                />
                <div className="mt-2 flex gap-2">
                  <button onClick={saveFile} className="flex-1 rounded-md bg-gold/90 px-3 py-1.5 text-xs font-medium text-black">
                    Guardar
                  </button>
                  <button
                    onClick={() => deleteFile(selected)}
                    className="rounded-md border border-red-900/60 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-950/40"
                  >
                    Borrar
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

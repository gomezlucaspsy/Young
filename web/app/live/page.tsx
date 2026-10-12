"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { fsApplyAction, fsList, fsTree, type FileAction } from "@/lib/virtual-fs";
import { useAgentId, useVfs, vfsCommit, vfsCurrent } from "@/lib/vfs-store";
import { parseUpdateItems, UPDATES_FILE } from "@/lib/updates";
import { checkYoung } from "@/lib/young-syntax";
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
import ChatPanel, { type ChatAttachment } from "@/components/live/ChatPanel";
import CommandPalette, { type Command } from "@/components/live/CommandPalette";
import ConnectPanel from "@/components/live/ConnectPanel";
import Editor from "@/components/live/Editor";
import Explorer from "@/components/live/Explorer";
import Icon, { type IconName } from "@/components/live/Icon";
import UpdatesPanel, { downloadUpdates } from "@/components/live/UpdatesPanel";
import type { AgentStatus, SidePanel, Turn, UpdatesConfig } from "@/components/live/types";

const UPDATES_PATH = `/${UPDATES_FILE}`;
type MobileView = "files" | "editor" | "chat";
type Toast = { id: number; text: string; ok: boolean };

function downloadTextFile(name: string, content: string) {
  const filename = name.split(/[\\/]/).filter(Boolean).pop() || "archivo.txt";
  const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

let nextId = 1;
const newId = () => nextId++;

async function pollCommand(commandId: string): Promise<{ result: string; ok: boolean }> {
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const res = await fetch(`/api/agent/status?commandId=${encodeURIComponent(commandId)}`);
      if (!res.ok) continue;
      const data = await res.json();
      const status = data?.command?.status;
      if (status === "completed" || status === "failed") {
        return { result: data.command.result || "(sin resultado)", ok: status === "completed" };
      }
    } catch {
      // network hiccup — keep polling
    }
  }
  return { result: "la PC no respondió a tiempo", ok: false };
}

function describeFileAction(action: FileAction, result: string): string {
  const name = (action.name ?? "").trim();
  if (result.startsWith("ERROR")) return result.replace(/^ERROR:\s*/, "");
  const verbs: Record<string, string> = { create: "Creó", update: "Editó", delete: "Borró", read: "Leyó", list: "Listó archivos" };
  return action.action === "list" ? verbs.list : `${verbs[action.action]} ${name}`;
}

export default function LivePage() {
  const agentId = useAgentId();
  const fs = useVfs();
  const files = fsList(fs);

  const [agent, setAgent] = useState<AgentStatus | null>(null);
  const [updatesConfig, setUpdatesConfig] = useState<UpdatesConfig | null>(null);

  const [sidePanel, setSidePanel] = useState<SidePanel | null>("explorer");
  const [mobileView, setMobileView] = useState<MobileView>("chat");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [creatingFile, setCreatingFile] = useState(false);

  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  // A real folder on this PC, opened with the browser's native permission
  // prompt (File System Access API) — every change is mirrored back to it.
  const [folder, setFolder] = useState<DirHandle | null>(null);
  const [pendingFolder, setPendingFolder] = useState<DirHandle | null>(null);

  const online = agent?.status === "online";
  const updatesContent = fs[UPDATES_PATH]?.content ?? null;
  const pendingUpdates = updatesContent ? parseUpdateItems(updatesContent).filter((i) => !i.done).length : 0;

  // Tabs whose file was deleted (by you or the Oracle) disappear on their own.
  const tabs = openTabs.filter((p) => fs[p]);
  const currentPath = activePath && fs[activePath] ? activePath : (tabs[tabs.length - 1] ?? null);
  const dirtyPaths = new Set(Object.keys(drafts).filter((p) => fs[p] && drafts[p] !== fs[p].content));
  const editorValue = currentPath ? (drafts[currentPath] ?? fs[currentPath]?.content ?? "") : "";
  const syntax = currentPath?.endsWith(".young") ? checkYoung(editorValue) : null;

  // ── Background sync ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/agent/status?agentId=${encodeURIComponent(agentId)}`);
        if (!res.ok) return;
        const data = await res.json();
        const mine = data.agent;
        const label = mine && mine.label?.length > 1 ? mine.label : mine?.platform;
        if (!cancelled) setAgent(mine ? { status: mine.status, label, platform: mine.platform } : { status: "offline" });
      } catch {
        if (!cancelled) setAgent({ status: "offline" });
      }
    };
    tick();
    const t = setInterval(tick, 5000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [agentId]);

  useEffect(() => {
    fetch("/api/updates")
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg) => cfg && setUpdatesConfig(cfg))
      .catch(() => {});
  }, []);

  useEffect(() => {
    restoreFolder().then((saved) => {
      if (!saved) return;
      if (saved.granted) importFromDisk(saved.handle);
      else setPendingFolder(saved.handle);
    });
    // importFromDisk only touches stable setters / the vfs store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Helpers ──────────────────────────────────────────────────────────────
  const toast = (text: string, ok = true) => {
    const id = newId();
    setToasts((prev) => [...prev, { id, text, ok }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3500);
  };

  const append = (turn: Turn) => setTurns((prev) => [...prev, turn]);

  // Disk wins on connect: the folder's files are merged into the browser copy.
  async function importFromDisk(handle: DirHandle) {
    const disk = await readFolder(handle);
    vfsCommit({ ...vfsCurrent(), ...disk });
    setFolder(handle);
    setPendingFolder(null);
    toast(`Carpeta "${handle.name}" abierta (${Object.keys(disk).length} archivos)`);
  }

  async function openFolder() {
    try {
      if (pendingFolder && (await regrantFolder(pendingFolder))) return importFromDisk(pendingFolder);
      if (folderAccessSupported()) return importFromDisk(await pickFolder());
      document.getElementById("young-file-import")?.click();
    } catch (err) {
      if ((err as DOMException)?.name !== "AbortError") toast(String(err), false);
    }
  }

  // Android / Firefox / Safari: no folder access, so import via the OS picker.
  async function importPickedFiles(list: FileList | null) {
    let next = vfsCurrent();
    let n = 0;
    for (const file of Array.from(list ?? [])) {
      if (!file.name.toLowerCase().endsWith(".young")) continue;
      const path = `/${file.name}`;
      const now = new Date().toISOString();
      next = { ...next, [path]: { type: "file", content: await file.text(), created: next[path]?.created ?? now, modified: now } };
      n++;
    }
    vfsCommit(next);
    toast(`${n} archivo(s) .young importados`);
  }

  function syncToDisk(name: string, content: string | null) {
    if (!folder) return;
    const clean = name.trim().replace(/^\/+/, "");
    (content === null ? deleteFolderFile(folder, clean) : writeFolderFile(folder, clean, content)).catch((err) =>
      toast(`No se pudo guardar ${clean} en la carpeta: ${err}`, false),
    );
  }

  const openFile = (path: string) => {
    setOpenTabs((prev) => (prev.includes(path) ? prev : [...prev, path]));
    setActivePath(path);
    setMobileView("editor");
  };

  const openPanel = (panel: SidePanel) => {
    setSidePanel(panel);
    setMobileView("files");
  };

  const startNewFile = () => {
    openPanel("explorer");
    setCreatingFile(true);
  };

  const focusChat = (prefill?: string) => {
    if (prefill !== undefined) setInput(prefill);
    setMobileView("chat");
    setTimeout(() => document.getElementById("oracle-input")?.focus(), 0);
  };

  function closeTab(path: string) {
    setOpenTabs((prev) => prev.filter((p) => p !== path));
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[path];
      return next;
    });
    if (currentPath === path) setActivePath(null);
  }

  const saveActive = () => {
    if (!currentPath || drafts[currentPath] === undefined) return;
    const { fs: next, result } = fsApplyAction(vfsCurrent(), {
      action: "update",
      path: "/",
      name: currentPath.slice(1),
      content: drafts[currentPath],
    });
    if (result.startsWith("ERROR")) {
      toast(result, false);
      return;
    }
    vfsCommit(next);
    syncToDisk(currentPath, drafts[currentPath]);
    setDrafts((prev) => {
      const copy = { ...prev };
      delete copy[currentPath];
      return copy;
    });
    toast(`Guardado ${currentPath.slice(1)}`);
  };

  function createFile(name: string, content = ""): string | null {
    const { fs: next, result } = fsApplyAction(vfsCurrent(), { action: "create", path: "/", name, content });
    if (result.startsWith("ERROR")) return result.replace(/^ERROR:\s*/, "");
    vfsCommit(next);
    syncToDisk(name, content);
    openFile(`/${name.trim().replace(/^\/+/, "")}`);
    return null;
  }

  function deleteFile(path: string) {
    const { fs: next, result } = fsApplyAction(vfsCurrent(), { action: "delete", path: "/", name: path.slice(1) });
    if (result.startsWith("ERROR")) {
      toast(result, false);
      return;
    }
    vfsCommit(next);
    syncToDisk(path, null);
    closeTab(path);
    toast(`Borrado ${path.slice(1)}`);
  }

  // ── Chat ─────────────────────────────────────────────────────────────────
  async function send(override?: string, attachments: ChatAttachment[] = []) {
    const userText = (override ?? input).trim();
    if ((!userText && attachments.length === 0) || busy) return;
    const text = userText || "Revisá los archivos adjuntos y ayudame a entenderlos.";
    setInput("");
    setMobileView("chat");
    const history = [
      ...turns,
      {
        id: newId(),
        role: "user" as const,
        text,
        attachments: attachments.map(({ name, kind }) => ({ name, kind })),
      },
    ];
    const latestId = history[history.length - 1].id;
    setTurns(history);
    setBusy(true);

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: history
            .filter((t) => t.role === "user" || t.role === "oracle")
            .map((t) => ({
              role: t.role === "oracle" ? "assistant" : "user",
              text: t.text,
              ...(t.role === "user" && t.id === latestId && attachments.length ? { attachments } : {}),
            })),
          filesTree: fsTree(vfsCurrent()),
          activeFile: currentPath ? { name: currentPath.slice(1), content: editorValue } : undefined,
          updatesFile: vfsCurrent()[UPDATES_PATH]?.content,
          agentId,
        }),
      });
      const data = await res.json();
      if (data.error) {
        append({ id: newId(), role: "error", text: String(data.error) });
        return;
      }

      for (const name of (data.syntaxFixed ?? []) as string[]) {
        append({ id: newId(), role: "action", ok: true, text: `Corrigió la sintaxis de ${name}` });
      }

      for (const repo of data.repoActions ?? []) {
        append({ id: newId(), role: "action", ok: !repo.summary.startsWith("ERROR"), text: `Leyó ${repo.param}` });
      }

      for (const action of (data.fileActions ?? []) as FileAction[]) {
        const { fs: next, result } = fsApplyAction(vfsCurrent(), action);
        vfsCommit(next);
        const ok = !result.startsWith("ERROR");
        const path = `/${(action.name ?? "").trim().replace(/^\/+/, "")}`;
        if (ok && action.action === "delete") syncToDisk(path, null);
        else if (ok && (action.action === "create" || action.action === "update")) syncToDisk(path, action.content ?? "");
        const isUpdates = path === UPDATES_PATH;
        append({
          id: newId(),
          role: "action",
          ok,
          text: describeFileAction(action, result) + (ok && isUpdates && action.action !== "read" ? " · revisar y enviar" : ""),
          path: ok && action.action !== "delete" && !isUpdates && action.action !== "list" ? path : undefined,
          panel: ok && isUpdates && action.action !== "delete" ? "updates" : undefined,
        });
        if (ok && (action.action === "create" || action.action === "update")) {
          // The Oracle's write wins over an unsaved draft of the same file.
          setDrafts((prev) => {
            if (!(path in prev)) return prev;
            const copy = { ...prev };
            delete copy[path];
            return copy;
          });
        }
      }

      append({ id: newId(), role: "oracle", text: data.reply || "(sin respuesta)" });

      for (const pc of data.pcActions ?? []) {
        if (!pc.commandId) {
          append({ id: newId(), role: "action", ok: false, text: pc.error || `No se pudo encolar ${pc.type}` });
          continue;
        }
        const id = newId();
        const label = `${pc.type}${pc.param ? ` ${pc.param}` : ""} en tu PC`;
        append({ id, role: "action", ok: true, pending: true, text: label });
        pollCommand(pc.commandId).then(({ result, ok }) => {
          setTurns((prev) =>
            prev.map((t) => (t.id === id ? { id, role: "action", ok, text: `${label}: ${result.split("\n")[0]}` } : t)),
          );
          if (result.includes("\n")) append({ id: newId(), role: "oracle", text: "```\n" + result + "\n```" });
        });
      }
    } catch (err) {
      append({ id: newId(), role: "error", text: `No se pudo hablar con el Oráculo: ${String(err)}` });
    } finally {
      setBusy(false);
    }
  }

  // ── Commands + shortcuts ─────────────────────────────────────────────────
  const commands: Command[] = [
    { id: "new", label: "Nuevo archivo", icon: "plus", run: startNewFile },
    { id: "save", label: "Guardar archivo", hint: "Ctrl+S", icon: "save", run: saveActive },
    ...(currentPath ? [{ id: "download", label: `Descargar ${currentPath.slice(1)}`, icon: "download" as IconName, run: () => downloadTextFile(currentPath.slice(1), editorValue) }] : []),
    { id: "chat", label: "Preguntar al Oráculo", hint: "Ctrl+L", icon: "sparkles", run: () => focusChat() },
    { id: "folder", label: folder ? `Carpeta abierta: ${folder.name}` : "Abrir carpeta de mi PC", icon: "files", run: openFolder },
    { id: "explorer", label: "Mostrar MyComputer", hint: "Ctrl+B", icon: "files", run: () => openPanel("explorer") },
    { id: "updates", label: "Updates: revisar y enviar a GitHub", icon: "updates", run: () => openPanel("updates") },
    { id: "connect", label: online ? "Mi PC (conectada)" : "Conectar mi PC", icon: "plug", run: () => openPanel("connect") },
    ...(updatesContent
      ? [
          { id: "dl-txt", label: "Descargar updates.txt", icon: "download" as IconName, run: () => downloadUpdates(updatesContent, "txt") },
          { id: "dl-pdf", label: "Descargar updates.pdf", icon: "download" as IconName, run: () => downloadUpdates(updatesContent, "pdf") },
        ]
      : []),
    { id: "clear", label: "Nueva conversación", icon: "sparkles", run: () => setTurns([]) },
    { id: "install", label: "Instalar en el celular", icon: "phone", run: () => window.dispatchEvent(new Event("young:open-install")) },
    ...files.map((f) => ({ id: `open:${f.path}`, label: f.name, hint: "abrir", icon: "files" as IconName, run: () => openFile(f.path) })),
  ];

  // Global shortcuts subscribe once and call the latest handlers via a ref.
  const shortcuts = useRef({ saveActive, focusChat });
  useEffect(() => {
    shortcuts.current = { saveActive, focusChat };
  });
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === "k" || (e.shiftKey && k === "p")) {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (k === "s") {
        e.preventDefault();
        shortcuts.current.saveActive();
      } else if (k === "b") {
        e.preventDefault();
        setSidePanel((p) => (p ? null : "explorer"));
      } else if (k === "l") {
        e.preventDefault();
        shortcuts.current.focusChat();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── Layout ───────────────────────────────────────────────────────────────
  const activity: { panel: SidePanel; icon: IconName; label: string; badge?: number; dot?: boolean }[] = [
    { panel: "explorer", icon: "files", label: "MyComputer" },
    { panel: "updates", icon: "updates", label: "Updates", badge: pendingUpdates || undefined },
    { panel: "connect", icon: "plug", label: "Conectar mi PC", dot: online },
  ];

  const welcome = (
    <div className="flex flex-1 items-center justify-center overflow-y-auto p-8">
      <div className="w-full max-w-md space-y-6">
        <div>
          <p className="font-[family-name:var(--font-display)] text-2xl tracking-wide text-zinc-100">Young Live</p>
          <p className="mt-1 text-sm text-zinc-500">Escribí rituales, pedíselos al Oráculo y mandá mejoras a GitHub.</p>
        </div>
        <div className="space-y-1 text-sm">
          {[
            { icon: "plus" as IconName, label: "Nuevo archivo", run: startNewFile },
            { icon: "sparkles" as IconName, label: "Pedirle algo al Oráculo", hint: "Ctrl+L", run: () => focusChat() },
            { icon: "updates" as IconName, label: "Revisar updates.txt", run: () => openPanel("updates") },
            { icon: "plug" as IconName, label: online ? "Tu PC está conectada" : "Conectar mi PC", run: () => openPanel("connect") },
          ].map((a) => (
            <button key={a.label} onClick={a.run} className="flex w-full items-center gap-3 rounded px-2 py-1.5 text-left text-violet hover:bg-white/5">
              <Icon name={a.icon} size={15} /> <span className="flex-1">{a.label}</span>
              {a.hint && <kbd className="font-mono text-[11px] text-zinc-600">{a.hint}</kbd>}
            </button>
          ))}
        </div>
        {files.length > 0 && (
          <div>
            <p className="mb-1 text-[11px] uppercase tracking-wider text-zinc-600">Recientes</p>
            {files.slice(0, 5).map((f) => (
              <button key={f.path} onClick={() => openFile(f.path)} className="block w-full truncate rounded px-2 py-1 text-left text-sm text-zinc-400 hover:bg-white/5 hover:text-zinc-200">
                {f.name}
              </button>
            ))}
          </div>
        )}
        <p className="text-xs text-zinc-600">
          <kbd className="rounded border border-white/10 px-1 font-mono">Ctrl K</kbd> abre todos los comandos.
        </p>
      </div>
    </div>
  );

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[#0a0910] text-sm text-zinc-200">
      {/* Title bar */}
      <header className="flex h-10 shrink-0 items-center gap-3 border-b border-white/[0.06] px-3">
        <Link href="/" className="font-[family-name:var(--font-display)] text-xs tracking-[0.3em] text-gold" title="Inicio">
          YOUNG
        </Link>
        <button
          onClick={() => setPaletteOpen(true)}
          className="mx-auto flex h-7 w-full max-w-md items-center gap-2 rounded-md border border-white/[0.08] bg-white/[0.03] px-3 text-xs text-zinc-500 hover:border-white/15 hover:text-zinc-300"
        >
          <Icon name="search" size={13} />
          <span className="flex-1 truncate text-left">Buscar archivos y comandos</span>
          <kbd className="hidden font-mono text-[11px] sm:inline">Ctrl K</kbd>
        </button>
        <span className="w-12" aria-hidden="true" />
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Activity bar */}
        <nav className="hidden w-12 shrink-0 flex-col items-center gap-1 border-r border-white/[0.06] py-2 md:flex" aria-label="Paneles">
          {activity.map((a) => {
            const active = sidePanel === a.panel;
            return (
              <button
                key={a.panel}
                onClick={() => setSidePanel(active ? null : a.panel)}
                title={a.label}
                aria-label={a.label}
                aria-pressed={active}
                className={`relative flex h-10 w-10 items-center justify-center rounded-md ${
                  active ? "text-zinc-100 before:absolute before:-left-1 before:h-6 before:w-0.5 before:rounded before:bg-violet" : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                <Icon name={a.icon} size={20} />
                {a.badge ? (
                  <span className="absolute right-1 top-1 min-w-4 rounded-full bg-violet px-1 text-[9px] font-semibold leading-4 text-white">{a.badge}</span>
                ) : null}
                {a.dot && <span className="absolute bottom-2 right-2 h-2 w-2 rounded-full border border-[#0a0910] bg-emerald-400" />}
              </button>
            );
          })}
          <button
            onClick={() => setMobileView(mobileView === "chat" ? "editor" : "chat")}
            title="Alternar editor / Oráculo"
            aria-label="Alternar editor y Oráculo"
            className="mt-auto flex h-10 w-10 items-center justify-center rounded-md text-zinc-500 hover:text-zinc-300 lg:hidden"
          >
            <Icon name="sparkles" size={20} />
          </button>
        </nav>

        {/* Side bar */}
        <aside
          className={`${mobileView === "files" ? "flex" : "hidden"} ${sidePanel ? "md:flex" : "md:hidden"} min-h-0 w-full flex-col border-r border-white/[0.06] bg-[#0c0b12] md:w-64 md:shrink-0`}
        >
          <div className="flex gap-1 border-b border-white/[0.06] p-1 md:hidden">
            {activity.map((a) => (
              <button
                key={a.panel}
                onClick={() => setSidePanel(a.panel)}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded py-1.5 text-xs ${
                  (sidePanel ?? "explorer") === a.panel ? "bg-white/10 text-zinc-100" : "text-zinc-500"
                }`}
              >
                <Icon name={a.icon} size={14} /> {a.label.split(" ")[0]}
              </button>
            ))}
          </div>
          {(sidePanel ?? "explorer") === "explorer" && (
            <Explorer
              files={files}
              activePath={currentPath}
              dirtyPaths={dirtyPaths}
              onOpen={openFile}
              onCreate={(name) => createFile(name)}
              onDelete={deleteFile}
              onDownload={(path) => downloadTextFile(path, drafts[path] ?? fs[path]?.content ?? "")}
              onAskOracle={(p) => send(p)}
              creating={creatingFile}
              setCreating={setCreatingFile}
              folderName={folder?.name ?? null}
              pendingFolderName={pendingFolder?.name ?? null}
              onOpenFolder={openFolder}
            />
          )}
          {sidePanel === "updates" && (
            <UpdatesPanel
              content={updatesContent}
              config={updatesConfig}
              onOpenFile={() => openFile(UPDATES_PATH)}
              onCreateEmpty={() => {
                const err = createFile(UPDATES_FILE, "[ ] ");
                if (err) toast(err, false);
              }}
              onAskOracle={(p) => send(p)}
              onToast={toast}
            />
          )}
          {sidePanel === "connect" && <ConnectPanel agentId={agentId} agent={agent} onToast={toast} />}
        </aside>

        {/* Editor */}
        <main className={`${mobileView === "editor" ? "flex" : "hidden"} ${mobileView !== "chat" ? "md:flex" : "md:hidden"} min-h-0 min-w-0 flex-1 lg:flex`}>
          <Editor
            tabs={tabs.map((p) => ({ path: p, name: p.slice(1), dirty: dirtyPaths.has(p) }))}
            activePath={currentPath}
            value={editorValue}
            onChange={(v) => currentPath && setDrafts((prev) => ({ ...prev, [currentPath]: v }))}
            onSave={saveActive}
            onDownload={() => currentPath && downloadTextFile(currentPath, editorValue)}
            onSelectTab={setActivePath}
            onCloseTab={closeTab}
            onAskOracle={(p) => focusChat(p)}
            welcome={welcome}
          />
        </main>

        {/* Oracle chat */}
        <section
          className={`${mobileView === "chat" ? "flex" : "hidden"} min-h-0 flex-1 flex-col border-l border-white/[0.06] bg-[#0c0b12] lg:flex lg:w-[380px] lg:flex-none`}
          aria-label="Chat con el Oráculo"
        >
          <ChatPanel
            turns={turns}
            input={input}
            busy={busy}
            onInput={setInput}
            onSend={send}
            onClear={() => setTurns([])}
            onOpenFile={openFile}
            onOpenPanel={openPanel}
          />
        </section>
      </div>

      {/* Status bar */}
      <footer className="flex h-6 shrink-0 items-center gap-1 border-t border-white/[0.06] bg-[#0c0b12] px-1 text-[11px] text-zinc-400">
        <button onClick={() => openPanel("connect")} className="flex h-full items-center gap-1.5 px-2 hover:bg-white/5">
          <span className={`h-2 w-2 rounded-full ${online ? "bg-emerald-400" : "bg-zinc-600"}`} />
          {online ? `PC conectada${agent?.label ? ` · ${agent.label}` : ""}` : "Conectar mi PC"}
        </button>
        <button onClick={() => openPanel("updates")} className="flex h-full items-center gap-1.5 px-2 hover:bg-white/5">
          <Icon name="updates" size={12} />
          {pendingUpdates ? `${pendingUpdates} pedido${pendingUpdates === 1 ? "" : "s"}` : "Updates"}
        </button>
        <span className="ml-auto hidden px-2 sm:inline">
          {files.length} archivo{files.length === 1 ? "" : "s"} · {folder ? `carpeta ${folder.name}` : "en este navegador"}
        </span>
        {syntax && (
          <span
            className={`flex h-full max-w-[45%] items-center gap-1 truncate px-2 ${syntax.ok ? "text-zinc-400" : "text-red-300"}`}
            title={syntax.ok ? "El archivo compila con el intérprete de Young" : `Línea ${syntax.line}: ${syntax.message}`}
          >
            {syntax.ok ? "✓ Sintaxis OK" : `✕ Línea ${syntax.line}: ${syntax.message}`}
          </span>
        )}
        {currentPath && <span className="hidden px-2 sm:inline">{currentPath.endsWith(".young") ? "Young" : "Texto"}</span>}
        <button onClick={() => window.dispatchEvent(new Event("young:open-install"))} className="flex h-full items-center gap-1 px-2 hover:bg-white/5 max-sm:ml-auto">
          <Icon name="phone" size={12} /> Instalar
        </button>
      </footer>

      {/* Mobile tab bar */}
      <nav className="flex shrink-0 border-t border-white/[0.06] bg-[#0c0b12] pb-[env(safe-area-inset-bottom)] md:hidden" aria-label="Vistas">
        {(
          [
            { view: "files", icon: "files", label: "Archivos" },
            { view: "editor", icon: "save", label: "Editor" },
            { view: "chat", icon: "sparkles", label: "Oráculo" },
          ] as { view: MobileView; icon: IconName; label: string }[]
        ).map((v) => (
          <button
            key={v.view}
            onClick={() => setMobileView(v.view)}
            aria-pressed={mobileView === v.view}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] ${mobileView === v.view ? "text-violet" : "text-zinc-500"}`}
          >
            <Icon name={v.icon} size={18} /> {v.label}
          </button>
        ))}
      </nav>

      <input
        id="young-file-import"
        type="file"
        accept=".young"
        multiple
        hidden
        onChange={(e) => {
          importPickedFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {paletteOpen && <CommandPalette commands={commands} onClose={() => setPaletteOpen(false)} />}

      <div className="pointer-events-none fixed bottom-10 right-4 z-50 flex flex-col items-end gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs shadow-lg ${
              t.ok ? "border-white/10 bg-[#17151f] text-zinc-200" : "border-red-900/60 bg-red-950/80 text-red-200"
            }`}
          >
            <Icon name={t.ok ? "check" : "alert"} size={13} /> {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}

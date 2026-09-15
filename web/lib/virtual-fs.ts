// A sandboxed, client-only "computer" filesystem for the Web Live tab — no
// server, no database. Only .young files live here, and only in this
// browser's localStorage, mirroring the project-root sandbox that the
// native and Python Live tabs enforce on the real filesystem.

export type FsFile = { type: "file"; content: string; created: string; modified: string };
export type FsMap = Record<string, FsFile>;

export type FsListItem = { name: string; path: string } & FsFile;

export type FileAction = {
  action: "create" | "read" | "update" | "delete" | "list";
  path: string;
  name?: string;
  type?: "file";
  content?: string;
};

const STORAGE_KEY = "young:vfs";

function normalizeName(name: string): string {
  return name.trim().replace(/^\/+/, "");
}

function fullPathOf(path: string, name: string): string {
  const base = path === "/" || !path ? "" : path.replace(/\/+$/, "");
  return `${base}/${normalizeName(name)}`;
}

export function fsLoad(): FsMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as FsMap) : {};
  } catch {
    return {};
  }
}

export function fsSave(fs: FsMap) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fs));
  } catch {
    // storage full/unavailable — silently no-op
  }
}

export function fsList(fs: FsMap): FsListItem[] {
  return Object.entries(fs)
    .map(([path, node]) => ({ name: path.replace(/^\/+/, ""), path, ...node }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Compact listing used as Claude's context for the Live tab.
export function fsTree(fs: FsMap): string {
  const keys = Object.keys(fs).sort();
  if (!keys.length) return "(no .young files yet)";
  return keys.map((p) => `${p} (${fs[p].content.length} chars)`).join("\n");
}

export function fsApplyAction(fs: FsMap, action: FileAction): { fs: FsMap; result: string } {
  if (action.action === "list") {
    return { fs, result: fsTree(fs) };
  }

  const name = action.name ? normalizeName(action.name) : "";
  if (!name.toLowerCase().endsWith(".young")) {
    return { fs, result: `ERROR: only .young files are allowed (got "${name || action.path}")` };
  }

  const fullPath = fullPathOf(action.path || "/", name);
  const next = { ...fs };

  if (action.action === "create") {
    if (next[fullPath]) return { fs, result: `ERROR: file already exists: ${fullPath}` };
    const now = new Date().toISOString();
    next[fullPath] = { type: "file", content: action.content ?? "", created: now, modified: now };
    return { fs: next, result: `OK: created ${fullPath}` };
  }

  if (action.action === "read") {
    const node = next[fullPath];
    if (!node) return { fs, result: `ERROR: file not found: ${fullPath}` };
    return { fs, result: `${fullPath}\n${node.content}` };
  }

  if (action.action === "update") {
    const existing = next[fullPath];
    if (!existing) return { fs, result: `ERROR: file not found: ${fullPath}` };
    next[fullPath] = { ...existing, content: action.content ?? "", modified: new Date().toISOString() };
    return { fs: next, result: `OK: updated ${fullPath}` };
  }

  if (action.action === "delete") {
    if (!next[fullPath]) return { fs, result: `ERROR: file not found: ${fullPath}` };
    delete next[fullPath];
    return { fs: next, result: `OK: deleted ${fullPath}` };
  }

  return { fs, result: `ERROR: unsupported action` };
}

// Both wire tags share one block terminator rule: a block is closed by the
// LAST "]" before the next [FILE_ACTION:/[PC_ACTION: tag (or end of text),
// not the first one. Young source content is full of "]" (arrays, blocks),
// so closing at the first "]" truncated file content mid-way — this is what
// let content run all the way up to the next tag/end of message instead.
const ACTION_TAGS = ["[FILE_ACTION:", "[PC_ACTION:"];

function extractActionBlocks(text: string, tag: string): string[] {
  const blocks: string[] = [];
  let searchFrom = 0;
  while (true) {
    const start = text.indexOf(tag, searchFrom);
    if (start === -1) break;
    const contentStart = start + tag.length;

    let nextTagAt = text.length;
    for (const t of ACTION_TAGS) {
      const idx = text.indexOf(t, contentStart);
      if (idx !== -1 && idx < nextTagAt) nextTagAt = idx;
    }

    const window = text.slice(contentStart, nextTagAt);
    const closeIdx = window.lastIndexOf("]");
    blocks.push(closeIdx === -1 ? window : window.slice(0, closeIdx));
    searchFrom = closeIdx === -1 ? nextTagAt : contentStart + closeIdx + 1;
  }
  return blocks;
}

// Parse [FILE_ACTION:action|path|name|type|content] blocks (same wire format
// used by the native and Python Live tabs, so prompts/behavior stay in sync).
export function parseFileActions(text: string): FileAction[] {
  const actions: FileAction[] = [];
  for (const block of extractActionBlocks(text, "[FILE_ACTION:")) {
    const fields = block.split("|");
    const action = (fields[0] || "").trim().toLowerCase();
    if (!["create", "read", "update", "delete", "list"].includes(action)) continue;
    actions.push({
      action: action as FileAction["action"],
      path: (fields[1] || "/").trim() || "/",
      name: (fields[2] || "").trim(),
      type: "file",
      content: fields.slice(4).join("|").trim(),
    });
  }
  return actions;
}

// [PC_ACTION:type|param] blocks — parsed client-side too, so the UI can show
// "queued" immediately without waiting on the chat response round-trip.
export type PcAction = { type: string; param: string };

export function parsePcActions(text: string): PcAction[] {
  const actions: PcAction[] = [];
  for (const block of extractActionBlocks(text, "[PC_ACTION:")) {
    const bar = block.indexOf("|");
    const type = (bar === -1 ? block : block.slice(0, bar)).trim().toLowerCase();
    const param = bar === -1 ? "" : block.slice(bar + 1).trim();
    if (type) actions.push({ type, param });
  }
  return actions;
}

export function stripActions(text: string): string {
  return text
    .split("[FILE_ACTION:")[0]
    .split("[PC_ACTION:")[0]
    .trim();
}

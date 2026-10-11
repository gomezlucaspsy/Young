// Real-folder access for the Web Live tab via the browser's File System
// Access API: showDirectoryPicker() makes Chrome/Edge show their own native
// "let this site view and edit files?" permission prompt — no launcher, no
// terminal. The granted handle is kept in IndexedDB so a reload only needs a
// one-click re-grant. Browsers without the API (Android, Firefox, Safari)
// fall back to the OS file picker via <input type="file"> in the page.

import type { FsMap } from "./virtual-fs";
import { isAllowedName } from "./virtual-fs";

type PermissionMode = { mode: "readwrite" };
type DirHandle = FileSystemDirectoryHandle & {
  queryPermission(d: PermissionMode): Promise<PermissionState>;
  requestPermission(d: PermissionMode): Promise<PermissionState>;
  values(): AsyncIterable<FileSystemHandle>;
};

const DB_NAME = "young-folder";
const STORE = "handles";
const KEY = "root";
const RW: PermissionMode = { mode: "readwrite" };

export function folderAccessSupported(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

function idb<T>(fn: (store: IDBObjectStore) => IDBRequest<T>, mode: IDBTransactionMode): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const req = fn(open.result.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    };
  });
}

// Must be called from a click — this is what triggers the native prompt.
export async function pickFolder(): Promise<DirHandle> {
  const picker = (window as unknown as { showDirectoryPicker(o: object): Promise<DirHandle> }).showDirectoryPicker;
  const handle = await picker({ id: "young", mode: "readwrite" });
  await idb((s) => s.put(handle, KEY), "readwrite").catch(() => {});
  return handle;
}

// The folder granted on a previous visit, and whether it is still usable
// without asking again (Chrome usually needs a re-grant after a restart).
export async function restoreFolder(): Promise<{ handle: DirHandle; granted: boolean } | null> {
  try {
    const handle = (await idb((s) => s.get(KEY), "readonly")) as DirHandle | undefined;
    if (!handle) return null;
    return { handle, granted: (await handle.queryPermission(RW)) === "granted" };
  } catch {
    return null;
  }
}

// Must be called from a click.
export async function regrantFolder(handle: DirHandle): Promise<boolean> {
  return (await handle.requestPermission(RW)) === "granted";
}

export async function forgetFolder() {
  await idb((s) => s.delete(KEY), "readwrite").catch(() => {});
}

export async function readFolder(handle: DirHandle): Promise<FsMap> {
  const fs: FsMap = {};
  for await (const entry of handle.values()) {
    if (entry.kind !== "file" || !isAllowedName(entry.name)) continue;
    const file = await (entry as FileSystemFileHandle).getFile();
    const stamp = new Date(file.lastModified).toISOString();
    fs[`/${entry.name}`] = { type: "file", content: await file.text(), created: stamp, modified: stamp };
  }
  return fs;
}

export async function writeFolderFile(handle: DirHandle, name: string, content: string) {
  const file = await handle.getFileHandle(name, { create: true });
  const w = await file.createWritable();
  await w.write(content);
  await w.close();
}

export async function deleteFolderFile(handle: DirHandle, name: string) {
  await handle.removeEntry(name).catch(() => {});
}

export type { DirHandle };

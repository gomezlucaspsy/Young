"use client";

// React binding for the localStorage-backed virtual filesystem (virtual-fs.ts)
// and a few other per-browser values, via useSyncExternalStore — so the Live
// UI re-renders on every write (including from other tabs) without setState
// calls inside effects, and SSR renders an empty, stable snapshot.

import { useSyncExternalStore } from "react";
import { fsLoad, fsSave, type FsMap } from "./virtual-fs";

const EMPTY_FS: FsMap = {};
const listeners = new Set<() => void>();
let cachedFs: FsMap | null = null;

function emit() {
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === "young:vfs") {
      cachedFs = null;
      cb();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

function getFsSnapshot(): FsMap {
  if (!cachedFs) cachedFs = fsLoad();
  return cachedFs;
}

export function useVfs(): FsMap {
  return useSyncExternalStore(subscribe, getFsSnapshot, () => EMPTY_FS);
}

// Always read-modify-write against the latest snapshot.
export function vfsCurrent(): FsMap {
  return getFsSnapshot();
}

export function vfsCommit(next: FsMap) {
  fsSave(next);
  cachedFs = next;
  emit();
}

// ── Agent id: one stable id per browser, created on first read ─────────────
let cachedAgentId = "";

function getAgentId(): string {
  if (cachedAgentId) return cachedAgentId;
  try {
    cachedAgentId = localStorage.getItem("young:agentId") || "";
    if (!cachedAgentId) {
      cachedAgentId = `young-${Math.random().toString(36).slice(2, 8)}`;
      localStorage.setItem("young:agentId", cachedAgentId);
    }
  } catch {
    cachedAgentId = `young-${Math.random().toString(36).slice(2, 8)}`;
  }
  return cachedAgentId;
}

const noopSubscribe = () => () => {};

export function useAgentId(): string {
  return useSyncExternalStore(noopSubscribe, getAgentId, () => "");
}

// True only after hydration — for values that exist only in the browser
// (window.location, navigator) without a mismatch on first render.
export function useIsClient(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

export type Turn =
  // `auto`: sent by auto mode itself (tool results fed back to the Oracle), not typed by the user.
  | { id: number; role: "user"; text: string; attachments?: { name: string; kind: "image" | "document" | "text" }[]; auto?: boolean }
  | { id: number; role: "oracle"; text: string }
  | { id: number; role: "error"; text: string }
  // Something the Oracle did (file write, repo read, PC action). `path` makes
  // it open that file on click; `panel` jumps to a side panel; `detail` is the
  // full output (e.g. a run_young error report), shown under the line.
  | { id: number; role: "action"; text: string; ok: boolean; pending?: boolean; path?: string; panel?: SidePanel; detail?: string };

export type SidePanel = "explorer" | "updates" | "connect";

export type AgentStatus = { status: "online" | "offline"; label?: string; platform?: string };

export type UpdatesConfig = {
  repo: string;
  actionsUrl: string;
  pullsUrl: string;
};

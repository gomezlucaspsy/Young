export type Turn =
  | { id: number; role: "user"; text: string }
  | { id: number; role: "oracle"; text: string }
  | { id: number; role: "error"; text: string }
  // Something the Oracle did (file write, repo read, PC action). `path` makes
  // it open that file on click; `panel` jumps to a side panel.
  | { id: number; role: "action"; text: string; ok: boolean; pending?: boolean; path?: string; panel?: SidePanel };

export type SidePanel = "explorer" | "updates" | "connect";

export type AgentStatus = { status: "online" | "offline"; label?: string; platform?: string };

export type UpdatesConfig = {
  repo: string;
  actionsUrl: string;
  pullsUrl: string;
};

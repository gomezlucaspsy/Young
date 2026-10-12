// In-memory control plane for the Young Host Agent.
//
// A host agent (young_host_agent.py) runs on the user's own machine, registers
// itself here, and polls for commands. The web chat route enqueues PC_ACTION
// commands the Live Agent asked for; the host agent executes them locally
// (through the same safe, fixed allowlist as the native/Python Live tabs) and
// reports the result back. Nothing here executes anything itself — nothing
// runs until the user's own host agent, on their own machine, picks it up.

export type CommandType = "status" | "list_processes" | "open_folder" | "run_young";

export type CommandStatus = "queued" | "dispatched" | "completed" | "failed";

export interface AgentState {
  agentId: string;
  label: string;
  platform: string;
  version: string;
  projectRoot: string;
  lastSeenAt: string;
  status: "online" | "offline";
}

export interface CommandState {
  id: string;
  agentId: string;
  type: CommandType;
  param: string;
  status: CommandStatus;
  createdAt: string;
  updatedAt: string;
  result?: string;
}

interface ControlPlaneStore {
  agents: Map<string, AgentState>;
  commands: Map<string, CommandState[]>;
}

declare global {
  var youngControlPlaneStore: ControlPlaneStore | undefined;
}

const store =
  globalThis.youngControlPlaneStore ??
  (globalThis.youngControlPlaneStore = {
    agents: new Map<string, AgentState>(),
    commands: new Map<string, CommandState[]>(),
  });

const OFFLINE_THRESHOLD_MS = 45_000;
const ALLOWED_TYPES: readonly CommandType[] = ["status", "list_processes", "open_folder", "run_young"];

function nowIso(): string {
  return new Date().toISOString();
}

function updateAgentStatus(agent: AgentState): AgentState {
  const lastSeenMs = new Date(agent.lastSeenAt).getTime();
  const online = Date.now() - lastSeenMs < OFFLINE_THRESHOLD_MS;
  return { ...agent, status: online ? "online" : "offline" };
}

export function isAllowedCommandType(type: string): type is CommandType {
  return (ALLOWED_TYPES as readonly string[]).includes(type);
}

export function upsertAgent(input: {
  agentId: string;
  label: string;
  platform: string;
  version: string;
  projectRoot: string;
}): AgentState {
  const current = store.agents.get(input.agentId);
  const next: AgentState = updateAgentStatus({
    agentId: input.agentId,
    label: input.label || current?.label || input.agentId,
    platform: input.platform || current?.platform || "unknown",
    version: input.version || current?.version || "0.0.0",
    projectRoot: input.projectRoot || current?.projectRoot || "",
    lastSeenAt: nowIso(),
    status: "online",
  });

  store.agents.set(input.agentId, next);
  if (!store.commands.has(input.agentId)) store.commands.set(input.agentId, []);
  return next;
}

export function heartbeatAgent(agentId: string): AgentState | null {
  const agent = store.agents.get(agentId);
  if (!agent) return null;
  const updated = updateAgentStatus({ ...agent, lastSeenAt: nowIso() });
  store.agents.set(agentId, updated);
  return updated;
}

export function getAgent(agentId: string): AgentState | null {
  const agent = store.agents.get(agentId);
  return agent ? updateAgentStatus(agent) : null;
}

export function listAgents(): AgentState[] {
  return Array.from(store.agents.values())
    .map(updateAgentStatus)
    .sort((a, b) => a.agentId.localeCompare(b.agentId));
}

export function enqueueCommand(input: { agentId: string; type: CommandType; param?: string }): CommandState {
  const queue = store.commands.get(input.agentId) ?? [];
  const timestamp = nowIso();

  const command: CommandState = {
    id: `${input.agentId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    agentId: input.agentId,
    type: input.type,
    param: input.param ?? "",
    status: "queued",
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  queue.push(command);
  store.commands.set(input.agentId, queue);
  return command;
}

export function dispatchPendingCommands(agentId: string): CommandState[] {
  const queue = store.commands.get(agentId) ?? [];
  const timestamp = nowIso();
  const toDispatch: CommandState[] = [];

  for (const command of queue) {
    if (command.status === "queued") {
      command.status = "dispatched";
      command.updatedAt = timestamp;
      toDispatch.push({ ...command });
    }
  }

  return toDispatch;
}

export function completeCommand(input: {
  agentId: string;
  commandId: string;
  success: boolean;
  result?: string;
}): CommandState | null {
  const queue = store.commands.get(input.agentId) ?? [];
  const command = queue.find((item) => item.id === input.commandId);
  if (!command) return null;

  command.status = input.success ? "completed" : "failed";
  command.result = input.result;
  command.updatedAt = nowIso();
  return { ...command };
}

export function getCommand(commandId: string): CommandState | null {
  for (const queue of store.commands.values()) {
    const found = queue.find((c) => c.id === commandId);
    if (found) return found;
  }
  return null;
}

export function snapshotState() {
  return {
    generatedAt: nowIso(),
    agents: listAgents(),
    commands: Array.from(store.commands.values())
      .flat()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 100),
  };
}

import { NextRequest, NextResponse } from "next/server";
import { enqueueCommand, getAgent, isAllowedCommandType, type CommandType } from "@/lib/control-plane";
import { parseFileActions, parsePcActions, stripActions, type FileAction } from "@/lib/virtual-fs";
import { readRepo } from "@/lib/github-repo";
import { checkYoung, YOUNG_SYNTAX_GUIDE } from "@/lib/young-syntax";

const SYSTEM_PROMPT_BASE = `You are Young Oracle, a live coding assistant for the Young language (.young files) running in a browser.

You can create, read, update, delete, or list files in the user's sandboxed browser filesystem (MyComputer) by ending your reply with FILE_ACTION blocks in exactly this format:
[FILE_ACTION:create|/|name.young|file|content]
[FILE_ACTION:read|/|name.young|file|]
[FILE_ACTION:update|/|name.young|file|new content]
[FILE_ACTION:delete|/|name.young|file|]
[FILE_ACTION:list|/|||]
Only .young files are allowed, plus one special file: updates.txt. These live only in this browser (localStorage) — they are NOT the user's real disk.

updates.txt is the change-request list for the Young app itself. When the user asks for an updates.txt or updates.pdf,
asks you to note feedback / improvements / bugs about Young, or agrees to one of your suggestions for the app, write
them there: one concrete, implementable request per line, formatted "[ ] <request>". If updates.txt already exists
(its current content is given below), update it keeping every existing line (never re-add a request that's already listed); otherwise
create it. Then tell the user in one short sentence that they can send it from the Updates panel ("Enviar a GitHub",
or download it as .txt/.pdf) — a bot turns new lines into a pull request that CodeRabbit reviews.

You can read any public GitHub repo the user links you to — no Host Agent needed for this one, it always works:
[PC_ACTION:read_repo|<github url or owner/repo>[@branch][|path/to/file]]
With no path it lists the repo's file tree; with a path it reads that one file's content. Use this whenever the
user pastes a GitHub link and wants you to read, explain, or work from it. The result comes back to you as a
TOOL_RESULT — read it and continue (summarize, answer, or chain another read_repo for a specific file) before
giving your final answer.

If (and only if) a Host Agent is connected, you can also check on or act within the user's REAL computer through a small FIXED set of other PC_ACTION commands. There is no generic shell/run-command action — only these four:
[PC_ACTION:status|]              disk free/total + OS info, no param
[PC_ACTION:list_processes|]      read-only process snapshot, no param
[PC_ACTION:open_folder|]         opens the project folder in the file explorer, no param
[PC_ACTION:run_young|name.young] runs an existing project script on the real machine, returns its output
Those four are queued for the Host Agent and can take a few seconds to complete — say you're checking, don't pretend to already have the answer. read_repo is different: it resolves immediately, in this same turn.

Never explain FILE_ACTION or PC_ACTION syntax to the user. Only emit a block when the request actually needs one. Reply concisely.
Any Young code you write — in FILE_ACTION content or in a reply — must follow the syntax guide below exactly. Every .young
file you create or update is checked by the real parser; if it fails you get the error back and must fix it.

${YOUNG_SYNTAX_GUIDE}`;

type ChatMessage = { role: "user" | "assistant"; text: string };
type ApiMessage = { role: "user" | "assistant"; content: string };

const MAX_TOOL_ROUNDS = 4;
const ACTIVE_FILE_MAX_CHARS = 8000;

async function callClaude(apiKey: string, system: string, messages: ApiMessage[]) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.YOUNG_CLAUDE_MODEL || "claude-haiku-4-5",
      max_tokens: 4096,
      system,
      messages,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Anthropic request failed (${res.status})`);
  }

  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  return (data.content ?? []).map((block) => (block.type === "text" ? block.text ?? "" : "")).join("");
}

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Missing ANTHROPIC_API_KEY" }, { status: 500 });
    }

    const body = (await request.json()) as {
      messages: ChatMessage[];
      filesTree?: string;
      activeFile?: { name?: string; content?: string };
      updatesFile?: string;
      agentId?: string;
    };

    const apiMessages: ApiMessage[] = (body.messages ?? [])
      .filter((m) => m.text?.trim())
      .map((m) => ({ role: m.role, content: m.text }));

    if (!apiMessages.length || apiMessages[0].role !== "user") {
      return NextResponse.json({ reply: "Send a message to get started." });
    }

    // Trust the server-side heartbeat, not the client's claim that the agent is online.
    const agentActive = Boolean(body.agentId && getAgent(body.agentId)?.status === "online");
    const system = [
      SYSTEM_PROMPT_BASE,
      "",
      "Current MyComputer (browser) contents:",
      body.filesTree?.trim() || "(empty)",
      "",
      body.updatesFile?.trim()
        ? "Current updates.txt (keep every line when you update it):\n```\n" +
          body.updatesFile.slice(0, ACTIVE_FILE_MAX_CHARS) +
          "\n```\n"
        : "",
      body.activeFile?.name
        ? `The user has ${body.activeFile.name} open in the editor (possibly unsaved). Its current content:\n` +
          "```\n" + String(body.activeFile.content ?? "").slice(0, ACTIVE_FILE_MAX_CHARS) + "\n```\n"
        : "",
      agentActive
        ? `A Host Agent is connected and online (id: ${body.agentId}). The other four PC_ACTION commands may be used.`
        : 'No Host Agent is currently connected — do NOT emit status/list_processes/open_folder/run_young. read_repo still works regardless. If the user asks for a real-computer action, tell them to click "Conectar mi PC" (bottom-left of the status bar) — it downloads a one-click launcher.',
    ].join("\n");

    const allFileActions: FileAction[] = [];
    const repoLog: { param: string; summary: string }[] = [];
    const queuedPcActions: { type: string; param: string; commandId: string | null; error?: string }[] = [];
    const syntaxFixed: string[] = [];
    const pendingFix = new Set<string>();

    let rawText = "";
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      rawText = await callClaude(apiKey, system, apiMessages);

      // Every .young the Oracle writes goes through the real parser's rules; a
      // file that wouldn't parse is sent back for a fix instead of being saved
      // (on the last round it is kept, so the editor can show the error).
      const lastRound = round === MAX_TOOL_ROUNDS - 1;
      const syntaxErrors: string[] = [];
      for (const fa of parseFileActions(rawText)) {
        const isYoung = (fa.name ?? "").trim().toLowerCase().endsWith(".young");
        const check = isYoung && (fa.action === "create" || fa.action === "update") ? checkYoung(fa.content ?? "") : { ok: true as const };
        const name = (fa.name ?? "").trim();
        if (check.ok || lastRound) {
          allFileActions.push(fa);
          // Only report a fix once a later round really produced a valid version.
          if (check.ok && pendingFix.delete(name)) syntaxFixed.push(name);
        } else {
          syntaxErrors.push(`${name} line ${check.line}: ${check.message}`);
          pendingFix.add(name);
        }
      }

      const rawPcActions = parsePcActions(rawText);
      const repoActions = rawPcActions.filter((pa) => pa.type === "read_repo");
      const otherActions = rawPcActions.filter((pa) => pa.type !== "read_repo");

      if (agentActive) {
        for (const pa of otherActions) {
          if (!isAllowedCommandType(pa.type)) {
            queuedPcActions.push({ type: pa.type, param: pa.param, commandId: null, error: `unknown PC_ACTION "${pa.type}"` });
            continue;
          }
          const command = enqueueCommand({ agentId: body.agentId as string, type: pa.type as CommandType, param: pa.param });
          queuedPcActions.push({ type: pa.type, param: pa.param, commandId: command.id });
        }
      }

      if (repoActions.length === 0 && syntaxErrors.length === 0) break;

      const assistantText = syntaxErrors.length ? rawText : stripActions(rawText);
      apiMessages.push({ role: "assistant", content: assistantText || rawText });

      const toolLines: string[] = syntaxErrors.length
        ? [
            "[young_syntax_check]: these files were NOT saved because the Young parser rejects them:\n" +
              syntaxErrors.join("\n") +
              "\n" +
              "Re-emit the same FILE_ACTION (same create/update) for each of them with corrected content, following the syntax guide exactly.",
          ]
        : [];
      for (const pa of repoActions) {
        const result = await readRepo(pa.param);
        toolLines.push(`[read_repo ${pa.param}]: ${result}`);
        repoLog.push({ param: pa.param, summary: result.split("\n")[0] });
      }
      apiMessages.push({
        role: "user",
        content: `TOOL_RESULTS:\n${toolLines.join("\n\n")}\n\nContinue. If the task is complete, give the final user-facing answer without any more PC_ACTION.`,
      });
    }

    const visible = stripActions(rawText) || "(no response)";
    return NextResponse.json({
      reply: visible,
      fileActions: allFileActions,
      pcActions: queuedPcActions,
      repoActions: repoLog,
      syntaxFixed: [...new Set(syntaxFixed)],
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

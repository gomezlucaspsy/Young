import { NextRequest, NextResponse } from "next/server";
import { getAgent, getCommand } from "@/lib/control-plane";

// Used by the browser UI. The agent id is an unguessable per-browser secret,
// so there is deliberately no "list every agent" view: ?agentId= returns only
// that agent, ?commandId= only that command (whose id embeds the agent id).
export async function GET(request: NextRequest) {
  const commandId = request.nextUrl.searchParams.get("commandId");
  if (commandId) {
    const command = getCommand(commandId);
    if (!command) return NextResponse.json({ error: "command not found" }, { status: 404 });
    return NextResponse.json({ command });
  }

  const agentId = request.nextUrl.searchParams.get("agentId");
  if (!agentId) return NextResponse.json({ error: "agentId query param is required" }, { status: 400 });
  return NextResponse.json({ agent: getAgent(agentId) });
}

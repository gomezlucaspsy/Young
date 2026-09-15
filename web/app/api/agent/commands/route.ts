import { NextRequest, NextResponse } from "next/server";
import { dispatchPendingCommands } from "@/lib/control-plane";

// Polled by young_host_agent.py — returns any newly-queued commands for this
// agent and marks them "dispatched" so they aren't handed out twice.
export async function GET(request: NextRequest) {
  const agentId = request.nextUrl.searchParams.get("agentId");
  if (!agentId) {
    return NextResponse.json({ error: "agentId query param is required" }, { status: 400 });
  }

  const commands = dispatchPendingCommands(agentId);
  return NextResponse.json({ commands });
}

import { NextRequest, NextResponse } from "next/server";
import { heartbeatAgent } from "@/lib/control-plane";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { agentId?: string };
  if (!body.agentId) {
    return NextResponse.json({ error: "agentId is required" }, { status: 400 });
  }

  const agent = heartbeatAgent(body.agentId);
  if (!agent) {
    // Server restarted / unknown agent — caller should re-register.
    return NextResponse.json({ error: "unknown agent, re-register" }, { status: 404 });
  }

  return NextResponse.json({ agent });
}

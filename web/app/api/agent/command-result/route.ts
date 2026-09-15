import { NextRequest, NextResponse } from "next/server";
import { completeCommand } from "@/lib/control-plane";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    agentId?: string;
    commandId?: string;
    success?: boolean;
    result?: string;
  };

  if (!body.agentId || !body.commandId) {
    return NextResponse.json({ error: "agentId and commandId are required" }, { status: 400 });
  }

  const command = completeCommand({
    agentId: body.agentId,
    commandId: body.commandId,
    success: body.success ?? false,
    result: body.result ?? "",
  });

  if (!command) {
    return NextResponse.json({ error: "command not found" }, { status: 404 });
  }

  return NextResponse.json({ command });
}

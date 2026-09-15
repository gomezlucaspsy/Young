import { NextRequest, NextResponse } from "next/server";
import { upsertAgent } from "@/lib/control-plane";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    agentId?: string;
    label?: string;
    platform?: string;
    version?: string;
    projectRoot?: string;
  };

  if (!body.agentId) {
    return NextResponse.json({ error: "agentId is required" }, { status: 400 });
  }

  const agent = upsertAgent({
    agentId: body.agentId,
    label: body.label ?? body.agentId,
    platform: body.platform ?? "unknown",
    version: body.version ?? "0.0.0",
    projectRoot: body.projectRoot ?? "",
  });

  return NextResponse.json({ agent });
}

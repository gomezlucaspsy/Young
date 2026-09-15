import { NextRequest, NextResponse } from "next/server";
import { getCommand, snapshotState } from "@/lib/control-plane";

// Used by the browser UI: with no query params, returns the full agents +
// recent-commands snapshot (to show "online/offline" and let the user pick a
// target agent). With ?commandId=, returns just that one command's status —
// used to poll a PC_ACTION result after the chat route enqueues it.
export async function GET(request: NextRequest) {
  const commandId = request.nextUrl.searchParams.get("commandId");
  if (commandId) {
    const command = getCommand(commandId);
    if (!command) return NextResponse.json({ error: "command not found" }, { status: 404 });
    return NextResponse.json({ command });
  }

  return NextResponse.json(snapshotState());
}

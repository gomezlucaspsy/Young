import { NextResponse } from "next/server";

// Public links for the Updates panel. Sending needs no server token: the panel
// opens GitHub's "new file" page pre-filled with the new requests, the owner
// presses "Commit changes", and that push triggers updates-to-pr.yml.
const repo = process.env.YOUNG_UPDATES_REPO || "gomezlucaspsy/Young";

export async function GET() {
  return NextResponse.json({
    repo,
    actionsUrl: `https://github.com/${repo}/actions/workflows/updates-to-pr.yml`,
    pullsUrl: `https://github.com/${repo}/pulls?q=is%3Apr+%5Bupdates-bot%5D`,
  });
}

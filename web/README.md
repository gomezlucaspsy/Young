This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Young Live (`/live`)

The browser version of the Live Agent, laid out like an IDE: activity bar
(MyComputer / Updates / Conectar mi PC), editor with tabs, Oracle chat on the
right, status bar, and a command palette (`Ctrl+K`). On phones it collapses
to one pane with a bottom tab bar.

- **FILE_ACTION** — a sandboxed filesystem in `localStorage`
  (`lib/virtual-fs.ts`, bound to React in `lib/vfs-store.ts`). Only `.young`
  files plus the special `updates.txt`. The browser applies the actions.
- **Downloads and Oracle attachments** — download a file from its editor tab
  or the MyComputer list. Attach up to five images, PDFs, or text/code files
  to an Oracle message (2 MB per file, 2.5 MB combined); attachments are sent
  with that message and are not saved to the browser filesystem.
- **PC_ACTION + control-plane** — `lib/control-plane.ts` is an in-memory
  register/heartbeat/command-queue store (resets on cold start; the Host
  Agent re-registers on its own). "Conectar mi PC" downloads a launcher from
  `/api/agent/connector` with the agent id and URL baked in; it fetches
  `young_host_agent.py`, `young_pc_actions.py` and `young_runner.py` from
  `public/agent/` (synced from the repo root by `scripts/sync-agent.mjs` on
  `predev`/`prebuild`) and runs the fixed allowlist — no generic shell action.
- **updates.txt → PR** — the Oracle writes change requests to `updates.txt`;
  "Enviar a GitHub" opens GitHub's new-file page pre-filled with only the
  not-yet-sent lines (tracked in localStorage) — no token, the owner just
  commits. It also downloads as .txt/.pdf. See `../updates/README.md`.

### Environment

| Variable | Needed for |
| --- | --- |
| `ANTHROPIC_API_KEY` | the Oracle chat (required) |
| `YOUNG_CLAUDE_MODEL` | optional model override (default `claude-haiku-4-5`) |
| `YOUNG_UPDATES_REPO` | optional, default `gomezlucaspsy/Young` |

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

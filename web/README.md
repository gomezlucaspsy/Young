This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Young Live (`/live`)

The browser version of the Live Agent. Two independent pieces:

- **FILE_ACTION** — a sandboxed `.young` filesystem that lives entirely in
  `localStorage` (`lib/virtual-fs.ts`). The chat route (`app/api/ai/chat`)
  asks Claude to emit `[FILE_ACTION:...]` blocks exactly like the native and
  Python Live tabs; the browser applies them client-side. No server access to
  a real disk is involved.
- **PC_ACTION + control-plane** — lets the Live Agent check on or act within
  the user's *real* machine, since a Vercel function can't touch their disk.
  `lib/control-plane.ts` is an in-memory register/heartbeat/command-queue
  store (per server instance — resets on redeploy/cold start, same
  limitation as any in-memory store on Vercel). The user runs
  `young_host_agent.py` (repo root) on their own machine; it registers itself
  under an id shown on `/live`, polls `GET /api/agent/commands`, executes
  through the fixed allowlist in `young_pc_actions.py` (`status`,
  `list_processes`, `open_folder`, `run_young` — deliberately no generic
  shell/run-command action), and reports back through
  `POST /api/agent/command-result`. The chat route only *enqueues* commands;
  it never executes anything itself.

Requires `ANTHROPIC_API_KEY` set in the environment (Vercel project settings,
or `.env.local` for `npm run dev`). Optional `YOUNG_CLAUDE_MODEL` overrides
the model (defaults to `claude-haiku-4-5`, matching the cheap defaults used
by the native/Python versions).

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

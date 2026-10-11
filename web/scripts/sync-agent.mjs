// Copies the Host Agent's Python files from the repo root into public/agent/
// so the "Conectar mi PC" launcher (app/api/agent/connector) can download
// them. Runs on prebuild/predev; a no-op when the repo root isn't present
// (e.g. a deploy with only web/), in which case the committed copies are used.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const webDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(webDir, "..");
const outDir = join(webDir, "public", "agent");
const files = ["young_host_agent.py", "young_pc_actions.py", "young_runner.py"];

mkdirSync(outDir, { recursive: true });
for (const f of files) {
  const src = join(repoRoot, f);
  if (existsSync(src)) copyFileSync(src, join(outDir, f));
  else if (!existsSync(join(outDir, f))) console.warn(`sync-agent: missing ${f}`);
}

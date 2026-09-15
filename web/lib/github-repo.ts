// Read-only GitHub repo reader for the Web Live Oracle's read_repo PC_ACTION.
// Runs entirely server-side in the /api/ai/chat route (no Host Agent needed —
// unlike the other PC_ACTIONs, reading a public GitHub repo doesn't touch the
// user's own machine), and mirrors young_pc_actions.py's pc_read_repo /
// native/young_studio.c's pc_read_repo so all three Live Agent surfaces
// behave the same way when handed a GitHub link.

const GITHUB_API_BASE = "https://api.github.com";
const REPO_TREE_MAX_ENTRIES = 200;
const REPO_FILE_MAX_CHARS = 8000;

type RepoRef = { owner: string; repo: string; branch?: string; path?: string };

type GithubJson = Record<string, unknown> & {
  default_branch?: string;
  content?: string;
  truncated?: boolean;
  tree?: { path: string; type: string }[];
  name?: string;
};

function parseRepoRef(raw: string): RepoRef | null {
  const trimmed = (raw || "").trim();
  if (!trimmed) return null;

  const m = /^(?:https?:\/\/)?(?:www\.)?github\.com\/(.+)$/i.exec(trimmed);
  const tail = (m ? m[1] : trimmed).replace(/^\/+|\/+$/g, "");
  const segments = tail.split("/").filter(Boolean);
  if (segments.length < 2) return null;

  const owner = segments[0];
  let repo = segments[1].toLowerCase().endsWith(".git") ? segments[1].slice(0, -4) : segments[1];

  let branch: string | undefined;
  let path: string | undefined;

  if (segments.length >= 4 && (segments[2] === "tree" || segments[2] === "blob")) {
    branch = segments[3];
    if (segments.length > 4) path = segments.slice(4).join("/");
  } else if (repo.includes("@")) {
    const [r, b] = repo.split("@");
    repo = r;
    branch = b;
  }

  return { owner, repo, branch, path };
}

async function githubRequest(path: string): Promise<{ ok: true; data: GithubJson | GithubJson[] } | { ok: false; error: string }> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "young-live-agent",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const res = await fetch(`${GITHUB_API_BASE}${path}`, { headers });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      return { ok: false, error: `HTTP ${res.status}: ${detail}` };
    }
    return { ok: true, data: await res.json() };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// param format: "<github url or owner/repo>[@branch][|path/to/file]"
export async function readRepo(param: string): Promise<string> {
  const raw = (param || "").trim();
  if (!raw) {
    return "ERROR: missing repo (expected a GitHub URL or owner/repo, optionally |path/to/file)";
  }

  const barIdx = raw.indexOf("|");
  const ref = (barIdx === -1 ? raw : raw.slice(0, barIdx)).trim();
  const extraPath = barIdx === -1 ? "" : raw.slice(barIdx + 1).trim();

  const parsed = parseRepoRef(ref);
  if (!parsed) return `ERROR: could not parse GitHub repo reference '${ref}'`;
  const { owner, repo } = parsed;
  let branch = parsed.branch;
  const path = extraPath || parsed.path || "";

  if (!branch) {
    const res = await githubRequest(`/repos/${owner}/${repo}`);
    if (!res.ok) return `ERROR: repo lookup failed for ${owner}/${repo}: ${res.error}`;
    const data = res.data as GithubJson;
    branch = data.default_branch || "main";
  }

  if (path) {
    const res = await githubRequest(`/repos/${owner}/${repo}/contents/${path}?ref=${branch}`);
    if (!res.ok) return `ERROR: could not read ${owner}/${repo}/${path}@${branch}: ${res.error}`;
    if (Array.isArray(res.data)) {
      const names = res.data.slice(0, REPO_TREE_MAX_ENTRIES).map((item) => item.name).join(", ");
      return `REPO_DIR ${owner}/${repo}@${branch}:/${path}\n${names}`;
    }
    let content: string;
    try {
      content = Buffer.from(res.data.content || "", "base64").toString("utf-8");
    } catch (err) {
      return `ERROR: could not decode file content: ${err}`;
    }
    return `REPO_FILE ${owner}/${repo}@${branch}:/${path}\n${content.slice(0, REPO_FILE_MAX_CHARS)}`;
  }

  const res = await githubRequest(`/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`);
  if (!res.ok) return `ERROR: could not list tree for ${owner}/${repo}@${branch}: ${res.error}`;
  const data = res.data as GithubJson;
  const entries = data.tree || [];
  const files = entries.filter((e) => e.type === "blob").slice(0, REPO_TREE_MAX_ENTRIES).map((e) => e.path);
  const truncated = Boolean(data.truncated) || entries.length > REPO_TREE_MAX_ENTRIES;
  const listing = files.join("\n");
  const suffix = truncated ? "\n... (truncated)" : "";
  return (
    `REPO_TREE ${owner}/${repo}@${branch} (${files.length} files shown)\n${listing}${suffix}\n` +
    `Use [PC_ACTION:read_repo|${owner}/${repo}@${branch}|path/to/file] to read one file.`
  );
}

"""Shared, fixed-allowlist PC actions for the Young Live Agent.

Used by both young_gui.py (the local Live tab's own process) and
young_host_agent.py (a headless process a Web Live session drives through the
control-plane). There is deliberately no generic "run shell command" entry —
only these five — so an LLM directing either surface can check on or act
within known-safe bounds instead of executing arbitrary strings it composes.

Kept dependency-free of tkinter/GUI code so young_host_agent.py can run
headless (e.g. on a machine with no display attached).
"""

import base64
import contextlib
import io
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

from young_runner import run as run_young

ALLOWED_TYPES = ("status", "list_processes", "open_folder", "run_young", "read_repo")

GITHUB_API_BASE = "https://api.github.com"
REPO_TREE_MAX_ENTRIES = 200
REPO_FILE_MAX_CHARS = 8000
_GITHUB_URL_RE = re.compile(r"^(?:https?://)?(?:www\.)?github\.com/(.+)$", re.IGNORECASE)


def sanitize_project_relpath(root_dir: Path, raw_path: str) -> str:
    rel = (raw_path or "").strip()
    while rel.startswith("/"):
        rel = rel[1:]
    if not rel:
        raise ValueError("Path cannot target project root directly")

    abs_path = (root_dir / rel).resolve()
    root_abs = root_dir.resolve()
    if os.path.commonpath([str(root_abs), str(abs_path)]) != str(root_abs):
        raise ValueError("Path escapes project root")

    return abs_path.relative_to(root_abs).as_posix()


def pc_status(root_dir: Path) -> str:
    try:
        usage = shutil.disk_usage(str(root_dir))
        free_gb = usage.free / (1024 ** 3)
        total_gb = usage.total / (1024 ** 3)
        return (f"OS: {platform.system()} {platform.release()} | "
                f"Disk: {free_gb:.1f} GB free of {total_gb:.1f} GB | "
                f"Project root: {root_dir}")
    except Exception as ex:
        return f"ERROR: {ex}"


def pc_list_processes() -> str:
    try:
        cmd = ["tasklist"] if sys.platform == "win32" else ["ps", "aux"]
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
        text = (out.stdout or out.stderr or "").strip()
        return text[:1800] if text else "(no output)"
    except Exception as ex:
        return f"ERROR: {ex}"


def pc_open_folder(root_dir: Path) -> str:
    try:
        if sys.platform == "win32":
            os.startfile(str(root_dir))  # noqa: S606 - user-owned project root only
        elif sys.platform == "darwin":
            subprocess.Popen(["open", str(root_dir)])
        else:
            subprocess.Popen(["xdg-open", str(root_dir)])
        return f"OK: opened {root_dir}"
    except Exception as ex:
        return f"ERROR: {ex}"


def pc_run_young(root_dir: Path, param: str) -> str:
    param = (param or "").strip()
    if not param:
        return "ERROR: missing filename"
    try:
        rel = sanitize_project_relpath(root_dir, param if param.startswith("/") else f"/{param}")
    except ValueError as ex:
        return f"ERROR: {ex}"
    if not rel.lower().endswith(".young"):
        return "ERROR: only .young files can be run"

    abs_path = root_dir / rel
    if not abs_path.exists():
        return f"ERROR: file not found: /{rel}"

    buf = io.StringIO()
    try:
        src = abs_path.read_text(encoding="utf-8")
        with contextlib.redirect_stdout(buf):
            run_young(src)
    except Exception as ex:
        return f"ERROR: {ex}\n{buf.getvalue()}"
    return f"OK: ran /{rel}\n{buf.getvalue()[:4000]}"


def _parse_repo_ref(raw: str):
    """Accepts a GitHub URL (optionally with /tree/<branch> or
    /blob/<branch>/path), 'owner/repo', or 'owner/repo@branch'.
    Returns (owner, repo, branch_or_None, path_or_None) or None."""
    raw = (raw or "").strip()
    if not raw:
        return None

    m = _GITHUB_URL_RE.match(raw)
    tail = m.group(1) if m else raw
    tail = tail.strip("/")
    segments = [s for s in tail.split("/") if s]
    if len(segments) < 2:
        return None

    owner, repo = segments[0], segments[1]
    if repo.lower().endswith(".git"):
        repo = repo[:-4]

    branch = None
    path = None
    if len(segments) >= 4 and segments[2] in ("tree", "blob"):
        branch = segments[3]
        if len(segments) > 4:
            path = "/".join(segments[4:])
    elif "@" in repo:
        repo, branch = repo.split("@", 1)

    return owner, repo, branch, path


def _github_request(path: str):
    """GET against the public GitHub REST API. Read-only — nothing here can
    write to GitHub. Works unauthenticated (60 req/hr); set GITHUB_TOKEN in
    the environment to raise that limit or reach private repos."""
    url = f"{GITHUB_API_BASE}{path}"
    req = urllib.request.Request(url, headers={
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "young-live-agent",
    })
    token = os.environ.get("GITHUB_TOKEN", "").strip()
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return True, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as ex:
        detail = ex.read().decode("utf-8", errors="ignore")[:300]
        return False, f"HTTP {ex.code}: {detail}"
    except Exception as ex:
        return False, str(ex)


def pc_read_repo(param: str) -> str:
    """read_repo|<GitHub URL or owner/repo>[@branch][|path/to/file]
    With no path: lists the repo's file tree. With a path: reads that one
    file's content. Public GitHub repos only, read-only."""
    param = (param or "").strip()
    if not param:
        return "ERROR: missing repo (expected a GitHub URL or owner/repo, optionally |path/to/file)"

    ref, _, extra_path = param.partition("|")
    ref = ref.strip()
    extra_path = extra_path.strip()

    parsed = _parse_repo_ref(ref)
    if not parsed:
        return f"ERROR: could not parse GitHub repo reference '{ref}'"
    owner, repo, branch, url_path = parsed
    path = extra_path or url_path or ""

    if not branch:
        ok, data = _github_request(f"/repos/{owner}/{repo}")
        if not ok:
            return f"ERROR: repo lookup failed for {owner}/{repo}: {data}"
        branch = data.get("default_branch", "main")

    if path:
        ok, data = _github_request(f"/repos/{owner}/{repo}/contents/{path}?ref={branch}")
        if not ok:
            return f"ERROR: could not read {owner}/{repo}/{path}@{branch}: {data}"
        if isinstance(data, list):
            names = ", ".join(item.get("name", "?") for item in data[:REPO_TREE_MAX_ENTRIES])
            return f"REPO_DIR {owner}/{repo}@{branch}:/{path}\n{names}"
        try:
            content = base64.b64decode(data.get("content", "")).decode("utf-8", errors="ignore")
        except Exception as ex:
            return f"ERROR: could not decode file content: {ex}"
        return f"REPO_FILE {owner}/{repo}@{branch}:/{path}\n{content[:REPO_FILE_MAX_CHARS]}"

    ok, tree_data = _github_request(f"/repos/{owner}/{repo}/git/trees/{branch}?recursive=1")
    if not ok:
        return f"ERROR: could not list tree for {owner}/{repo}@{branch}: {tree_data}"
    entries = tree_data.get("tree", [])
    files = [e["path"] for e in entries if e.get("type") == "blob"][:REPO_TREE_MAX_ENTRIES]
    truncated = tree_data.get("truncated", False) or len(entries) > REPO_TREE_MAX_ENTRIES
    listing = "\n".join(files)
    suffix = "\n... (truncated)" if truncated else ""
    return (
        f"REPO_TREE {owner}/{repo}@{branch} ({len(files)} files shown)\n{listing}{suffix}\n"
        f"Use [PC_ACTION:read_repo|{owner}/{repo}@{branch}|path/to/file] to read one file."
    )


def execute_pc_action(root_dir: Path, ptype: str, param: str) -> str:
    """The ONLY five PC_ACTION types that exist — no generic shell/run-command action."""
    if ptype == "status":
        return pc_status(root_dir)
    if ptype == "list_processes":
        return pc_list_processes()
    if ptype == "open_folder":
        return pc_open_folder(root_dir)
    if ptype == "run_young":
        return pc_run_young(root_dir, param)
    if ptype == "read_repo":
        return pc_read_repo(param)
    return f"ERROR: unknown PC_ACTION '{ptype}' (allowed: {', '.join(ALLOWED_TYPES)})"

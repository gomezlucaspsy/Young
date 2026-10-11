#!/usr/bin/env python3
"""Young Host Agent — headless bridge between the Web Live control-plane and
a real local machine.

The Web Live page (web/app/live) runs entirely server/browser-side and has no
access to your actual disk or processes. This script fills that gap: it
registers with the deployed Young Web app's control-plane, polls for
PC_ACTION commands the Live Agent queued during a chat, executes them through
the same fixed, safe allowlist as the native/Python Live tabs
(young_pc_actions.py — there is deliberately no generic shell/run-command
action), and reports the result back so the browser can display it.

Config via environment variables:
  YOUNG_CONTROL_PLANE_URL   base URL of the deployed Young Web app
                            (default: http://localhost:3000)
  YOUNG_AGENT_ID            the id shown on the Web Live page (required)
  YOUNG_PROJECT_ROOT        project root for run_young/open_folder/status
                            (default: this script's own directory)
  YOUNG_AGENT_LABEL         friendly label shown in the control-plane
                            (default: this machine's hostname)

Run:
  YOUNG_AGENT_ID=young-ab12cd YOUNG_CONTROL_PLANE_URL=https://your-deploy.vercel.app \
      python young_host_agent.py
"""

import argparse
import json
import os
import platform
import socket
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import young_pc_actions

VERSION = "0.1.0"
HEARTBEAT_INTERVAL_S = 15
POLL_INTERVAL_S = 3
REQUEST_TIMEOUT_S = 10


def _post(url: str, payload: dict) -> dict:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"content-type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_S) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _get(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=REQUEST_TIMEOUT_S) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser(description="Young Host Agent")
    parser.add_argument("--id", dest="agent_id", help="agent id shown on the Web Live page")
    parser.add_argument("--url", dest="base_url", help="base URL of the Young Web app")
    args = parser.parse_args()

    base_url = (args.base_url or os.environ.get("YOUNG_CONTROL_PLANE_URL", "http://localhost:3000")).rstrip("/")
    agent_id = (args.agent_id or os.environ.get("YOUNG_AGENT_ID", "")).strip()
    if not agent_id:
        print("ERROR: missing agent id. Use the 'Conectar mi PC' button on the Young Web Live page,",
              file=sys.stderr)
        print("       or run: python young_host_agent.py --id <id> --url <url>", file=sys.stderr)
        return 1

    root_dir = Path(os.environ.get("YOUNG_PROJECT_ROOT", str(Path(__file__).resolve().parent))).resolve()
    label = os.environ.get("YOUNG_AGENT_LABEL", socket.gethostname())

    print(f"Young Host Agent v{VERSION}")
    print(f"  control plane : {base_url}")
    print(f"  agent id      : {agent_id}")
    print(f"  project root  : {root_dir}")
    print(f"  allowed PC_ACTION types: {', '.join(young_pc_actions.ALLOWED_TYPES)}")
    print("  (no generic shell/run-command action exists - nothing else can be dispatched)")

    def register() -> None:
        _post(f"{base_url}/api/agent/register", {
            "agentId": agent_id,
            "label": label,
            "platform": platform.system(),
            "version": VERSION,
            "projectRoot": str(root_dir),
        })

    try:
        register()
        print("Connected. Young Live now shows this PC as online. Waiting for commands (Ctrl+C to stop)...")
    except (urllib.error.URLError, OSError) as ex:
        print(f"ERROR: could not reach control plane at {base_url}: {ex}", file=sys.stderr)
        return 1

    last_heartbeat = 0.0
    try:
        while True:
            now = time.time()
            if now - last_heartbeat >= HEARTBEAT_INTERVAL_S:
                try:
                    _post(f"{base_url}/api/agent/heartbeat", {"agentId": agent_id})
                except urllib.error.HTTPError as ex:
                    # 404 = the control plane restarted (in-memory store, e.g. a
                    # Vercel cold start) and forgot us — register again.
                    if ex.code == 404:
                        try:
                            register()
                        except (urllib.error.URLError, OSError):
                            pass
                except (urllib.error.URLError, OSError):
                    pass  # transient — the next heartbeat will retry
                last_heartbeat = now

            try:
                data = _get(f"{base_url}/api/agent/commands?agentId={agent_id}")
                for command in data.get("commands", []):
                    ptype = command.get("type", "")
                    param = command.get("param", "")
                    command_id = command.get("id")
                    print(f"-> {ptype}({param})")
                    result = young_pc_actions.execute_pc_action(root_dir, ptype, param)
                    ok = not result.startswith("ERROR")
                    print(f"<- {'OK' if ok else 'ERROR'}: {result[:200]}")
                    try:
                        _post(f"{base_url}/api/agent/command-result", {
                            "agentId": agent_id,
                            "commandId": command_id,
                            "success": ok,
                            "result": result,
                        })
                    except (urllib.error.URLError, OSError) as ex:
                        print(f"ERROR: could not report result: {ex}", file=sys.stderr)
            except (urllib.error.URLError, OSError):
                pass  # transient network issue — keep polling

            time.sleep(POLL_INTERVAL_S)
    except KeyboardInterrupt:
        print("\nStopped.")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())

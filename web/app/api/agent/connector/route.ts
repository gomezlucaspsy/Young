import { NextRequest, NextResponse } from "next/server";

// "Conectar mi PC": returns a ready-to-double-click launcher with this
// browser's agent id and this deployment's URL baked in, so nobody has to
// type environment variables. The launcher works inside an existing Young
// folder (next to young_runner.py) or creates ~/Young, fetches the three
// Host Agent files from /agent/ if they're missing, and starts the agent.

const AGENT_FILES = ["young_host_agent.py", "young_pc_actions.py", "young_runner.py"];
const AGENT_ID_RE = /^young-[a-z0-9]{16,32}$/;

function windowsScript(agentId: string, baseUrl: string): string {
  const fetches = AGENT_FILES.map(
    (f) =>
      // In ~/Young (created by this launcher) always refresh, so allowlist and
      // network fixes reach every PC; inside a Young checkout, never overwrite.
      `if "%FRESH%"=="1" del /q "${f}" 2>nul\r\n` +
      `if not exist "${f}" powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -UseBasicParsing '%YOUNG_CONTROL_PLANE_URL%/agent/${f}' -OutFile '${f}'"`,
  ).join("\r\n");
  return [
    "@echo off",
    "setlocal",
    "title Young - Conector de PC",
    `set "YOUNG_AGENT_ID=${agentId}"`,
    `set "YOUNG_CONTROL_PLANE_URL=${baseUrl}"`,
    'set "PYTHONUNBUFFERED=1"',
    "",
    'set "FRESH=0"',
    'if exist "%~dp0young_runner.py" (set "YOUNG_DIR=%~dp0") else (set "YOUNG_DIR=%USERPROFILE%\\Young" & set "FRESH=1")',
    'if not exist "%YOUNG_DIR%" mkdir "%YOUNG_DIR%"',
    'cd /d "%YOUNG_DIR%"',
    "",
    "set PY=",
    "where py >nul 2>nul && set PY=py -3",
    "if not defined PY where python >nul 2>nul && set PY=python",
    "if not defined PY (",
    "  echo.",
    "  echo  Falta Python 3 en esta PC. Te abro la pagina de descarga:",
    '  echo  instalalo marcando "Add python.exe to PATH" y volve a abrir este archivo.',
    "  start https://www.python.org/downloads/",
    "  pause",
    "  exit /b 1",
    ")",
    "",
    "echo Preparando archivos en %YOUNG_DIR% ...",
    fetches,
    "",
    "echo.",
    "echo  Conectando con Young Live. Deja esta ventana abierta; cerrala para desconectar.",
    "echo.",
    "%PY% young_host_agent.py",
    "pause",
    "",
  ].join("\r\n");
}

function unixScript(agentId: string, baseUrl: string): string {
  const fetches = AGENT_FILES.map(
    (f) =>
      `if [ "$YOUNG_DIR" = "$HOME/Young" ] || [ ! -f "${f}" ]; then curl -fsSL "$YOUNG_CONTROL_PLANE_URL/agent/${f}" -o "${f}.tmp" && mv "${f}.tmp" "${f}"; fi`,
  ).join("\n");
  return [
    "#!/bin/sh",
    "# Young - Conector de PC. macOS: doble clic. Linux: sh conectar-young.command",
    `export YOUNG_AGENT_ID="${agentId}"`,
    `export YOUNG_CONTROL_PLANE_URL="${baseUrl}"`,
    "export PYTHONUNBUFFERED=1",
    'HERE="$(cd "$(dirname "$0")" && pwd)"',
    'if [ -f "$HERE/young_runner.py" ]; then YOUNG_DIR="$HERE"; else YOUNG_DIR="$HOME/Young"; fi',
    'mkdir -p "$YOUNG_DIR" && cd "$YOUNG_DIR" || exit 1',
    "PY=$(command -v python3 || command -v python)",
    'if [ -z "$PY" ]; then echo "Falta Python 3: https://www.python.org/downloads/"; exit 1; fi',
    'echo "Preparando archivos en $YOUNG_DIR ..."',
    fetches,
    'echo "Conectando con Young Live. Deja esta ventana abierta; cerrala para desconectar."',
    'exec "$PY" young_host_agent.py',
    "",
  ].join("\n");
}

export async function GET(request: NextRequest) {
  const agentId = request.nextUrl.searchParams.get("agentId") ?? "";
  const os = request.nextUrl.searchParams.get("os") === "unix" ? "unix" : "windows";
  if (!AGENT_ID_RE.test(agentId)) {
    return NextResponse.json({ error: "agentId inválido" }, { status: 400 });
  }

  const baseUrl = request.nextUrl.origin;
  const isWindows = os === "windows";
  const script = isWindows ? windowsScript(agentId, baseUrl) : unixScript(agentId, baseUrl);
  const filename = isWindows ? "conectar-young.bat" : "conectar-young.command";

  return new NextResponse(script, {
    headers: {
      "content-type": isWindows ? "application/x-bat; charset=utf-8" : "text/x-shellscript; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}

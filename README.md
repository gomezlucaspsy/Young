# Young

Young is a small, symbolic programming language (`.young` files) plus a
**Live Agent** ("Young Oracle") that chats with Claude and can create, read,
run and edit `.young` files for you. The same Live Agent exists in three
parallel implementations — a Python desktop app, a native Win32 C app and a
Next.js web app — that all speak one shared text protocol.

> **For AI agents reading this repo:** start here. This file maps every
> directory, every language and every moving part, and lists the invariants you
> must keep when changing code. Deeper docs are linked at the end.

---

## 1. Repository map

```
Young/
├── young_runner.py            Python  — the Young language: tokenizer, parser, interpreter, C transpiler, REPL
├── young_gui.py               Python  — "Young Studio" desktop app (Tkinter) + Live Agent loop
├── young_pc_actions.py        Python  — fixed allowlist of PC_ACTION commands (shared by GUI + host agent)
├── young_host_agent.py        Python  — headless bridge: lets the web app run PC_ACTIONs on a real machine
├── run-young.bat              Batch   — run a .young file (python young_runner.py %*)
├── run-young-gui.bat          Batch   — launch the Python Studio with cheap Claude defaults
├── run-young-studio.bat       Batch   — launch the native C Studio (native/build/Release/young_studio.exe)
├── *.young                    Young   — sample programs (sample.young, sample_tarot.young, …)
├── README_YOUNG_ASSEMBLY.md   Docs    — language tutorial (syntax, tarot/Jung naming, C profile)
├── .github/copilot-instructions.md   project guidance for coding assistants
│
├── native/                    C (C11, Win32, MSVC + CMake)
│   ├── claude_client.h        public API: claude_message(), github_get()
│   ├── claude_client_winhttp.c  WinHTTP implementation (HTTPS to api.anthropic.com / api.github.com)
│   ├── main.c                 young_haiku_cli.exe — tiny CLI that sends one prompt to Claude
│   ├── young_studio.c         young_studio.exe — native Win32 Live Agent GUI (chat + MyComputer + mic/TTS)
│   ├── young_studio.manifest.in  Windows manifest (common controls v6)
│   ├── CMakeLists.txt         builds both executables
│   └── build/                 CMake/MSBuild output (generated — do not hand-edit)
│
└── web/                       TypeScript (Next.js 16 App Router, React 19, Tailwind 4) — deploys to Vercel
    ├── app/page.tsx           landing page (Spanish UI): download cards for the Python/native Studios
    ├── app/live/page.tsx      /live — browser Live Agent (chat + MyComputer + Host Agent status)
    ├── app/api/ai/chat/route.ts   calls Claude, parses actions, runs read_repo, enqueues PC_ACTIONs
    ├── app/api/agent/*/route.ts   control-plane HTTP API used by young_host_agent.py
    ├── lib/virtual-fs.ts      localStorage .young filesystem + FILE_ACTION/PC_ACTION parsers
    ├── lib/control-plane.ts   in-memory agent registry + command queue
    ├── lib/github-repo.ts     read-only GitHub reader for the read_repo action
    ├── components/InstallQR.tsx  QR code for installing / opening the app
    ├── public/downloads/*.zip packaged Python and native Studio builds
    ├── public/manifest.json, sw.js   PWA manifest + service worker
    └── AGENTS.md / CLAUDE.md  Next.js agent rules (this Next version differs from training data — read them)
```

Languages at a glance:

| Language | Where | Role |
|---|---|---|
| **Young** (`.young`) | root `*.young` | The DSL itself — user programs |
| **Python 3.10+** | root `*.py` | Reference implementation of the language + Python Studio + host agent |
| **C11 / Win32** | `native/` | Claude HTTP client, CLI, and native Studio GUI (Windows only) |
| **TypeScript / TSX** | `web/` | Browser Studio, API routes, control-plane (Next.js on Vercel) |
| **Batch** | root `*.bat` | Windows launchers |
| **PowerShell** (embedded) | inside `young_gui.py` / `young_studio.c` | mic dictation (`System.Speech`) and text-to-speech, run hidden |

---

## 2. The Young language (`young_runner.py`)

There is exactly **one** implementation of the language: `young_runner.py`.
The GUIs never re-implement it — the Python GUI imports it, the native app and
the host agent shell out to `python young_runner.py <file>`.

### Pipeline

```
source ─► tokenize() ─► Parser.parse_program() ─► (imports, rituals)
                                                     ├─► Runtime.run()          interpret
                                                     └─► CTranspiler.transpile() emit C (--emit-c)
```

- **`tokenize(src)`** — single regex; `#` starts a comment; strings, ints,
  identifiers, operators.
- **`Parser`** — recursive descent producing **tuples**, not classes:
  `("block", [stmts])`, `("vardecl", mut, name, expr)`, `("assign", name, expr)`,
  `("if", cond, then, else)`, `("while", cond, body)`, `("return", expr)`,
  `("halt",)`, `("spawn", expr)`, `("join", expr)`, `("cost", body)`,
  `("expr", expr)`.
  **Expressions are not parsed into an AST** — `parse_expr_until()` joins tokens
  back into a Python-syntax string (`&&`→`and`, `||`→`or`).
- **`Runtime`** — tree-walking interpreter. Each expression string is evaluated
  with `eval()` with `__builtins__` emptied and a whitelist injected
  (`print, len, range, sum, min, max, sorted, str, int, float, bool, math, json`,
  imported modules, `spawn`, `join`, and every ritual as a callable).
  Every ritual call gets a fresh env; `return` is a `ReturnSignal` exception and
  is coerced to `int`.
- **`validate_c_profile()` + `CTranspiler`** — `--strict-c-profile` rejects
  Python-only constructs (imports, `str()`, `float()`, `math.`, `json.`,
  `spawn/join`, string concatenation); `CTranspiler` emits C where every value is
  `int` and `print` becomes a `_Generic` `YOUNG_PRINT` macro.
- **`run_repl()`** — no args and no default file found → interactive REPL.

### Syntax cheat sheet

Each construct has a plain keyword **and** a tarot alias; both parse identically.

| Construct | Plain | Tarot alias |
|---|---|---|
| function | `ritual name(a: Int) -> Int { … }` | — |
| variables | `let x: Int = 1;` / `mut y = 2;` (types are parsed but ignored) | — |
| if / else | `if cond { } else { }` | `CHARIOT IF cond { } ELSE { }` |
| loop | `while cond { }` | `STRENGTH WHILE cond { }` |
| print / trace | `print(x);` | `HIEROPHANT print(x);` |
| stop program | `halt;` | `WORLD;` |
| task value | `spawn expr;` / `join h;` | `EMPRESS` / `LOVERS` |
| cost annotation | `cost <= ON { … }` (no-op wrapper, documents complexity) | — |
| import Python module | `use json as js;` | — |

A program **must** define `ritual main()`; its return value is the process exit code.

```young
ritual main() -> Int {
  mut n: Int = 10;
  mut acc: Int = 0;
  cost <= ON {
    STRENGTH WHILE n > 0 { acc = acc + n; n = n - 1; }
  }
  CHARIOT IF acc == 55 { HIEROPHANT print("ok"); return 0; } ELSE { return 1; }
}
```

The tarot / Jungian naming (`shadow`, `anima`, `self`, `individuation`, arcana)
is a deliberate design layer — see `README_YOUNG_ASSEMBLY.md`.

### Run it

```powershell
python young_runner.py sample.young                       # interpret
python young_runner.py sample_cosmic_physics.young --strict-c-profile --emit-c native/generated_young.c
python young_runner.py                                    # REPL (if no default sample is found)
```

---

## 3. The Live Agent — three parallel surfaces

| Surface | File(s) | UI toolkit | How it reaches Claude | Where "MyComputer" files live |
|---|---|---|---|---|
| Python Studio | `young_gui.py` | Tkinter | spawns `native/build/Release/young_haiku_cli.exe` | real disk, sandboxed to project root |
| Native Studio | `native/young_studio.c` | raw Win32 API | `claude_message()` over WinHTTP, in-process | real disk, sandboxed to project root |
| Web Live | `web/app/live/page.tsx` + `web/app/api/ai/chat/route.ts` | React | `fetch` to Anthropic Messages API, server-side | browser `localStorage` (`young:vfs`) |

All three show the same layout: chat on the left, a MyComputer file panel
(list / editor / New / Save / Run / Delete) on the right, input + Mic at the
bottom, rarely-used options behind Settings. All three use the same brand
palette (`web/app/globals.css` ↔ `C_*` colors in `young_studio.c`).

Default model is the cheap one: `claude-haiku-4-5`, overridable with
`YOUNG_CLAUDE_MODEL`. `YOUNG_MAX_TOKENS` / `YOUNG_TEMPERATURE` tune the native
paths. API key: `ANTHROPIC_API_KEY` (env var, or the Settings field in the desktop apps).

### Agent loop (same shape everywhere)

1. Build a prompt: system instructions + current `.young` file tree + last ~10
   turns + user message.
2. Call Claude.
3. Parse `[FILE_ACTION:…]` and `[PC_ACTION:…]` blocks out of the reply; strip them
   from the text shown to the user.
4. Execute them, feed results back as `TOOL_RESULTS`, and call Claude again —
   bounded (5 rounds in Python, 4 tool rounds on the web).
5. Every executed action is echoed in the transcript (e.g. `⚙ SYSTEM: type(param) -> result`)
   so nothing touches the machine invisibly.

### Shared protocol

```text
[FILE_ACTION:create|/folder|name.young|file|content]
[FILE_ACTION:read|/folder|name.young|file|]
[FILE_ACTION:update|/folder|name.young|file|new content]
[FILE_ACTION:delete|/folder|name.young|file|]        # web only; desktop delete is a UI button
[FILE_ACTION:list|/|||]

[PC_ACTION:status|]                 disk / RAM / OS summary
[PC_ACTION:list_processes|]         read-only process snapshot
[PC_ACTION:open_folder|]            open the project root in the file explorer
[PC_ACTION:run_young|name.young]    run an existing project .young file, return output
[PC_ACTION:read_repo|<github url or owner/repo>[@branch][|path/to/file]]
                                    no path → repo file tree; with path → that file's content
```

Fallback (desktop): if the model narrates a create but forgets the tag, a bare
`*.young` filename + fenced code block in the reply is auto-created and logged as
`auto-detected create`.

### Where each PC_ACTION is implemented

| Action | Python (`young_pc_actions.py`) | Native (`young_studio.c`) | Web |
|---|---|---|---|
| `status`, `list_processes`, `open_folder`, `run_young` | `execute_pc_action()` | `execute_pc_action()` | queued in `lib/control-plane.ts`, executed by `young_host_agent.py` on the user's machine |
| `read_repo` | `pc_read_repo()` | `pc_read_repo()` + `github_get()` | `lib/github-repo.ts`, resolved server-side in the same chat turn |

### Web ↔ real machine: the control-plane

A Vercel function cannot touch the user's disk, so the web app uses a
pull-based bridge:

```
browser /live ──POST /api/ai/chat──► route.ts ──enqueueCommand()──► lib/control-plane.ts (in-memory)
                                                                          ▲      │
young_host_agent.py (user's PC) ──register / heartbeat / GET commands─────┘      │
        │ executes via young_pc_actions.execute_pc_action()                      │
        └──POST /api/agent/command-result────────────────────────────────────────┘
browser polls GET /api/agent/status?commandId=… to show the result
```

Routes: `api/agent/register`, `heartbeat`, `commands`, `command-result`, `status`.
The agent id is generated in the browser (`localStorage["young:agentId"]`) and
shown on `/live`; the user runs
`YOUNG_AGENT_ID=<id> YOUNG_CONTROL_PLANE_URL=<url> python young_host_agent.py`.

**Known limitation:** the control-plane store is in-memory per server
instance, so on Vercel serverless it can reset on cold start / redeploy or
differ between instances.

---

## 4. Invariants — keep these when changing code

1. **Parity.** A change to the protocol, prompt, allowed actions or UI layout of
   one Live surface must be mirrored in the other two (`young_gui.py` +
   `young_pc_actions.py`, `native/young_studio.c`, `web/app/api/ai/chat/route.ts`
   + `web/lib/*`). Comments in each file point at their counterparts.
2. **Fixed allowlist, never a shell.** PC actions are a small named enum
   (`ALLOWED_TYPES` in Python, the `execute_pc_action` dispatcher in C,
   `CommandType` in TS). Never add a generic "run command" / shell-exec action
   for the model to drive.
3. **Sandbox.** File actions and `run_young` only accept `.young` files inside
   the project root; path traversal is rejected (`sanitize_project_relpath`,
   `safe_young_path`). `read_repo` is read-only.
4. **One language implementation.** Language changes go in `young_runner.py`
   only; if new syntax isn't C-transpilable, add it to `validate_c_profile()`.
5. **Cheap by default.** Haiku, low `max_tokens`, low temperature; keep prompts short.
6. **Next.js here is newer than your training data** — read `web/AGENTS.md`
   and `web/node_modules/next/dist/docs/` before editing `web/`.
7. `native/build/` and `__pycache__/` are generated output; don't edit them by hand.

---

## 5. Build & run

```powershell
# Language
python young_runner.py sample.young

# Native (Windows, needs CMake + MSVC)
cmake -S native -B native/build
cmake --build native/build --config Release
$env:ANTHROPIC_API_KEY="sk-ant-..."
./native/build/Release/young_haiku_cli.exe "hello"
./run-young-studio.bat            # native Studio

# Python Studio (reaches Claude via young_haiku_cli.exe; builds it with CMake on first use if missing)
./run-young-gui.bat               # or: python young_gui.py

# Web
cd web
npm install
npm run dev                       # http://localhost:3000 and /live ; needs ANTHROPIC_API_KEY in .env.local

# Host agent (lets web /live act on this PC)
$env:YOUNG_AGENT_ID="young-xxxxxx"; $env:YOUNG_CONTROL_PLANE_URL="http://localhost:3000"
python young_host_agent.py
```

There is no automated test suite; verify by running a sample `.young` file
(`sample.young` should print a pass message and exit 0) and by exercising the
Live Agent in each surface you touched.

---

## 6. Further reading

- `README_YOUNG_ASSEMBLY.md` — language tutorial, architecture patterns, C transpile profile
- `native/README.md` — native client, cost tuning, Live Agent / MyComputer / PC_ACTION details, mic & voice
- `web/README.md` — web Live Agent, FILE_ACTION in localStorage, control-plane
- `web/AGENTS.md` — rules for editing the Next.js app
- `.github/copilot-instructions.md` — product priorities (practical pain points, ecosystem integration, run UX)

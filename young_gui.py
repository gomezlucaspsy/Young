import contextlib
import io
import os
import re
import subprocess
import sys
import threading
import traceback
from pathlib import Path
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

from young_runner import run as run_young


class YoungGui(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Young Studio Live")
        self.geometry("1180x760")
        self.minsize(980, 620)

        self.root_dir = Path(__file__).resolve().parent
        self.last_young_output = ""

        self.script_path_var = tk.StringVar(value=str(self._default_script_path()))
        self.api_key_var = tk.StringVar(value=os.environ.get("ANTHROPIC_API_KEY", ""))
        self.status_var = tk.StringVar(value="Ready")
        self.goal_var = tk.StringVar(value="build some assembly .young code")
        self.arcana_var = tk.StringVar(value="IX - THE HERMIT")
        self.complexity_var = tk.StringVar(value="balanced")
        self.constraints_var = tk.StringVar(value="Keep runtime deterministic and under O(n).")
        self.live_input_var = tk.StringVar(value="")
        self.live_voice_var = tk.BooleanVar(value=True)
        self.live_history = []
        self.is_live_busy = False

        self._apply_color_theme()
        self._build_layout()

    def _apply_color_theme(self):
        self.configure(bg="#0d1021")

        style = ttk.Style(self)
        try:
            style.theme_use("clam")
        except tk.TclError:
            pass

        style.configure("TFrame", background="#0d1021")
        style.configure("TLabelframe", background="#141938", foreground="#e9ecff", borderwidth=1)
        style.configure("TLabelframe.Label", background="#141938", foreground="#7ce8ff", font=("Segoe UI", 10, "bold"))
        style.configure("TLabel", background="#0d1021", foreground="#d8dcff")
        style.configure("Header.TLabel", background="#0d1021", foreground="#7ce8ff", font=("Segoe UI", 14, "bold"))
        style.configure("Hint.TLabel", background="#0d1021", foreground="#9ea6d8")
        style.configure("TButton", background="#2a3c7a", foreground="#f3f6ff", padding=(10, 6), borderwidth=0)
        style.map("TButton", background=[("active", "#3652a3")])
        style.configure("Accent.TButton", background="#00a6c8", foreground="#00121a", padding=(10, 6), borderwidth=0)
        style.map("Accent.TButton", background=[("active", "#2cd3f4")])
        style.configure("Danger.TButton", background="#ff5579", foreground="#22000b", padding=(10, 6), borderwidth=0)
        style.map("Danger.TButton", background=[("active", "#ff7a97")])
        style.configure("TEntry", fieldbackground="#0f1a3b", foreground="#e9ecff")
        style.configure("TCombobox", fieldbackground="#0f1a3b", foreground="#e9ecff")
        style.configure("TNotebook", background="#0d1021", borderwidth=0)
        style.configure("TNotebook.Tab", background="#1a2150", foreground="#cfd8ff", padding=(12, 6))
        style.map("TNotebook.Tab", background=[("selected", "#00a6c8")], foreground=[("selected", "#00121a")])

    def _default_script_path(self) -> Path:
        candidates = [
            self.root_dir / "sample_painpoint.young",
            self.root_dir / "sample_rituals_tarot.young",
            self.root_dir / "sample_tarot.young",
            self.root_dir / "sample.young",
        ]
        for path in candidates:
            if path.exists():
                return path
        return self.root_dir / "sample.young"

    def _build_layout(self):
        self.columnconfigure(0, weight=1)
        self.rowconfigure(2, weight=1)

        banner = ttk.Frame(self, padding=(12, 10, 12, 0))
        banner.grid(row=0, column=0, sticky="ew")
        banner.columnconfigure(0, weight=1)
        ttk.Label(banner, text="Young Studio Live", style="Header.TLabel").grid(row=0, column=0, sticky="w")
        ttk.Label(
            banner,
            text="Live-first .young workflow: talk, create files via MyComputer, run immediately.",
            style="Hint.TLabel",
        ).grid(row=1, column=0, sticky="w", pady=(2, 0))

        top = ttk.Frame(self, padding=(12, 10))
        top.grid(row=1, column=0, sticky="ew")
        top.columnconfigure(1, weight=1)

        ttk.Label(top, text="Young File").grid(row=0, column=0, sticky="w")
        ttk.Entry(top, textvariable=self.script_path_var).grid(row=0, column=1, sticky="ew", padx=8)
        ttk.Button(top, text="Browse", command=self.on_browse_script).grid(row=0, column=2, padx=(0, 8))
        ttk.Button(top, text="Run Young", command=self.on_run_young, style="Accent.TButton").grid(row=0, column=3, padx=(0, 8))
        ttk.Button(top, text="Mic Input", command=self.on_live_mic).grid(row=0, column=4, padx=(0, 8))
        ttk.Button(top, text="Build Native", command=self.on_build_native).grid(row=0, column=5)

        self.tabs = ttk.Notebook(self)
        self.tabs.grid(row=2, column=0, sticky="nsew", padx=12, pady=6)

        run_tab = ttk.Frame(self.tabs, padding=8)
        compose_tab = ttk.Frame(self.tabs, padding=8)
        live_tab = ttk.Frame(self.tabs, padding=8)

        self.tabs.add(run_tab, text="Run")
        self.tabs.add(compose_tab, text="Compose")
        self.tabs.add(live_tab, text="Live")

        run_tab.columnconfigure(0, weight=1)
        run_tab.rowconfigure(0, weight=1)

        run_main = ttk.Panedwindow(run_tab, orient=tk.HORIZONTAL)
        run_main.grid(row=0, column=0, sticky="nsew")

        left = ttk.Frame(run_main, padding=6)
        left.columnconfigure(0, weight=1)
        left.rowconfigure(1, weight=1)

        right = ttk.Frame(run_main, padding=6)
        right.columnconfigure(0, weight=1)
        right.rowconfigure(1, weight=1)

        run_main.add(left, weight=1)
        run_main.add(right, weight=1)

        ttk.Label(left, text="Young Output").grid(row=0, column=0, sticky="w")
        self.young_output_text = tk.Text(left, wrap="word", height=18)
        self.young_output_text.grid(row=1, column=0, sticky="nsew", pady=(6, 0))
        self.young_output_text.configure(bg="#0c1431", fg="#cfd8ff", insertbackground="#79e7ff", relief="flat")

        ttk.Label(right, text="Claude Response").grid(row=0, column=0, sticky="w")
        self.claude_output_text = tk.Text(right, wrap="word", height=18)
        self.claude_output_text.grid(row=1, column=0, sticky="nsew", pady=(6, 0))
        self.claude_output_text.configure(bg="#15163d", fg="#f3ddff", insertbackground="#7ce8ff", relief="flat")

        key_frame = ttk.LabelFrame(run_tab, text="API", padding=(8, 6))
        key_frame.grid(row=1, column=0, sticky="ew", pady=(8, 0))
        key_frame.columnconfigure(1, weight=1)
        ttk.Label(key_frame, text="Anthropic API Key").grid(row=0, column=0, sticky="w")
        ttk.Entry(key_frame, textvariable=self.api_key_var, show="*").grid(row=0, column=1, sticky="ew", padx=8)
        ttk.Label(key_frame, text="Only used in memory for this app process.", style="Hint.TLabel").grid(row=0, column=2, sticky="w")

        compose_tab.columnconfigure(0, weight=1)

        composer = ttk.LabelFrame(compose_tab, text="Young Composer", padding=(8, 6))
        composer.grid(row=0, column=0, sticky="ew", pady=(0, 8))
        composer.columnconfigure(1, weight=1)
        composer.columnconfigure(3, weight=1)

        ttk.Label(composer, text="Goal").grid(row=0, column=0, sticky="w")
        ttk.Entry(composer, textvariable=self.goal_var).grid(row=0, column=1, sticky="ew", padx=(6, 12))

        ttk.Label(composer, text="Arcana").grid(row=0, column=2, sticky="w")
        ttk.Combobox(
            composer,
            textvariable=self.arcana_var,
            values=[
                "0 - THE FOOL",
                "I - THE MAGICIAN",
                "II - THE HIGH PRIESTESS",
                "III - THE EMPRESS",
                "IV - THE EMPEROR",
                "V - THE HIEROPHANT",
                "VI - THE LOVERS",
                "VII - THE CHARIOT",
                "VIII - STRENGTH",
                "IX - THE HERMIT",
                "X - WHEEL OF FORTUNE",
                "XI - JUSTICE",
                "XII - THE HANGED MAN",
                "XIII - DEATH",
                "XIV - TEMPERANCE",
                "XV - THE DEVIL",
                "XVI - THE TOWER",
                "XVII - THE STAR",
                "XVIII - THE MOON",
                "XIX - THE SUN",
                "XX - JUDGEMENT",
                "XXI - THE WORLD",
            ],
            state="readonly",
        ).grid(row=0, column=3, sticky="ew", padx=(6, 0))

        ttk.Label(composer, text="Complexity").grid(row=1, column=0, sticky="w", pady=(6, 0))
        ttk.Combobox(
            composer,
            textvariable=self.complexity_var,
            values=["cheap", "balanced", "rich"],
            state="readonly",
        ).grid(row=1, column=1, sticky="w", padx=(6, 12), pady=(6, 0))

        ttk.Label(composer, text="Constraints").grid(row=1, column=2, sticky="w", pady=(6, 0))
        ttk.Entry(composer, textvariable=self.constraints_var).grid(row=1, column=3, sticky="ew", padx=(6, 0), pady=(6, 0))

        composer_actions = ttk.Frame(composer)
        composer_actions.grid(row=2, column=0, columnspan=4, sticky="w", pady=(8, 0))
        ttk.Button(composer_actions, text="Build Coding Prompt", command=self.on_build_coding_prompt).grid(row=0, column=0, padx=(0, 8))
        ttk.Button(composer_actions, text="Insert .young Scaffold", command=self.on_insert_young_scaffold).grid(row=0, column=1)

        ttk.Label(compose_tab, text="Claude Prompt").grid(row=1, column=0, sticky="w")
        self.prompt_text = tk.Text(compose_tab, wrap="word", height=10)
        self.prompt_text.grid(row=2, column=0, sticky="ew", pady=(6, 8))

        actions = ttk.Frame(compose_tab)
        actions.grid(row=3, column=0, sticky="w")
        ttk.Button(actions, text="Ask Claude", command=self.on_ask_claude, style="Accent.TButton").grid(row=0, column=0, padx=(0, 8))
        ttk.Button(actions, text="Interpret Young Output", command=self.on_interpret_output).grid(row=0, column=1)

        live_tab.columnconfigure(0, weight=1)
        live_tab.rowconfigure(1, weight=1)

        live = ttk.LabelFrame(live_tab, text="Live Agent (Haiku + MyComputer)", padding=(8, 6))
        live.grid(row=0, column=0, sticky="nsew")
        live.columnconfigure(0, weight=1)
        live.rowconfigure(2, weight=1)

        live_controls = ttk.Frame(live)
        live_controls.grid(row=0, column=0, sticky="ew")
        live_controls.columnconfigure(0, weight=1)

        self.live_input_entry = ttk.Entry(live_controls, textvariable=self.live_input_var)
        self.live_input_entry.grid(row=0, column=0, sticky="ew", padx=(0, 8))
        self.live_input_entry.bind("<Return>", self._on_live_enter)
        ttk.Button(live_controls, text="Send", command=self.on_live_send, style="Accent.TButton").grid(row=0, column=1, padx=(0, 8))
        ttk.Button(live_controls, text="Mic", command=self.on_live_mic).grid(row=0, column=2, padx=(0, 8))
        ttk.Button(live_controls, text="Clear", command=self.on_live_clear, style="Danger.TButton").grid(row=0, column=3)

        quick = ttk.Frame(live)
        quick.grid(row=1, column=0, sticky="w", pady=(6, 0))
        ttk.Label(quick, text="Quick:", style="Hint.TLabel").grid(row=0, column=0, padx=(0, 6))
        ttk.Button(quick, text="Create .young file", command=lambda: self._fill_live_input("Create a new .young file with rituals for chakras and physics work formula."))\
            .grid(row=0, column=1, padx=(0, 6))
        ttk.Button(quick, text="Read current file", command=lambda: self._fill_live_input("Read my current .young file and explain improvements."))\
            .grid(row=0, column=2, padx=(0, 6))
        ttk.Button(quick, text="Update for C profile", command=lambda: self._fill_live_input("Update my .young code to be strict C-transpilable and keep symbolic naming."))\
            .grid(row=0, column=3)
        ttk.Checkbutton(quick, text="Voice reply", variable=self.live_voice_var).grid(row=0, column=4, padx=(12, 0))

        self.live_output_text = tk.Text(live, wrap="word", height=18)
        self.live_output_text.grid(row=2, column=0, sticky="ew", pady=(6, 0))
        self.live_output_text.configure(bg="#10223f", fg="#e2fff6", insertbackground="#63ffd6", relief="flat")

        status = ttk.Label(self, textvariable=self.status_var, anchor="w", padding=(12, 6))
        status.grid(row=3, column=0, sticky="ew")

    def _set_status(self, text: str):
        self.status_var.set(text)

    def _set_text(self, widget: tk.Text, value: str):
        widget.configure(state="normal")
        widget.delete("1.0", tk.END)
        widget.insert("1.0", value)
        widget.configure(state="normal")

    def _normalize_api_key(self, value: str) -> str:
        key = (value or "").strip()
        if (key.startswith('"') and key.endswith('"')) or (key.startswith("'") and key.endswith("'")):
            key = key[1:-1].strip()
        return key

    def _is_auth_error(self, stderr_text: str) -> bool:
        s = (stderr_text or "").lower()
        return "authentication_error" in s or "invalid x-api-key" in s or "invalid api key" in s

    def _resolve_api_key(self):
        typed_api_key = self._normalize_api_key(self.api_key_var.get())
        env_api_key = self._normalize_api_key(os.environ.get("ANTHROPIC_API_KEY", ""))
        api_key = typed_api_key or env_api_key
        return api_key, typed_api_key, env_api_key

    def _call_claude_native(self, prompt: str, timeout: int = 180):
        exe_path = self._find_native_exe()
        if exe_path is None:
            ok, built_exe, build_log = self._build_native_binary()
            if not ok or built_exe is None:
                return False, "", build_log
            exe_path = built_exe

        api_key, typed_api_key, env_api_key = self._resolve_api_key()
        if not api_key:
            return False, "", "Missing API key. Set ANTHROPIC_API_KEY or enter it in the GUI."

        if typed_api_key and typed_api_key != self.api_key_var.get():
            self.api_key_var.set(typed_api_key)

        env = os.environ.copy()
        env["ANTHROPIC_API_KEY"] = api_key

        def run_call(with_key: str):
            call_env = dict(env)
            call_env["ANTHROPIC_API_KEY"] = with_key
            return subprocess.run(
                [str(exe_path), prompt],
                cwd=self.root_dir,
                text=True,
                capture_output=True,
                env=call_env,
                timeout=timeout,
            )

        proc = run_call(api_key)

        if (
            proc.returncode != 0
            and self._is_auth_error(proc.stderr)
            and typed_api_key
            and env_api_key
            and typed_api_key != env_api_key
        ):
            fallback_proc = run_call(env_api_key)
            if fallback_proc.returncode == 0:
                self.api_key_var.set(env_api_key)
                return True, (fallback_proc.stdout.strip() or "(empty response)"), ""
            proc = fallback_proc

        if proc.returncode != 0:
            stderr = proc.stderr.strip()
            if self._is_auth_error(stderr):
                text = (
                    "Claude call failed (authentication).\n\n"
                    "The API key was rejected by Anthropic (HTTP 401 invalid x-api-key).\n"
                    "Re-copy your ANTHROPIC_API_KEY from Anthropic Console and paste it again.\n"
                    "If launching from desktop, set the key directly in this GUI field.\n\n"
                    f"Raw error:\n{stderr}"
                )
            else:
                text = f"Claude call failed (code {proc.returncode})\n\n{stderr}"
            return False, "", text

        return True, (proc.stdout.strip() or "(empty response)"), ""

    def _live_append(self, role: str, text: str):
        current = self.live_output_text.get("1.0", tk.END).strip()
        block = f"{role}:\n{text.strip()}\n"
        next_value = f"{current}\n\n{block}".strip() if current else block
        self._set_text(self.live_output_text, next_value)

    def _fill_live_input(self, text: str):
        self.live_input_var.set(text)
        self.live_input_entry.focus_set()

    def _on_live_enter(self, _event):
        self.on_live_send()
        return "break"

    def _run_hidden_powershell(self, ps_script: str, timeout: int):
        ps_exe = os.path.join(os.environ.get("WINDIR", "C:\\Windows"), "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
        if not os.path.exists(ps_exe):
            ps_exe = "powershell"

        kwargs = {
            "cwd": self.root_dir,
            "text": True,
            "capture_output": True,
            "timeout": timeout,
        }

        if sys.platform == "win32":
            startup = subprocess.STARTUPINFO()
            startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            kwargs["startupinfo"] = startup
            kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)

        return subprocess.run(
            [ps_exe, "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps_script],
            **kwargs,
        )

    def _capture_mic_text_windows(self):
        ps_script = r'''
Add-Type -AssemblyName System.Speech
$recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine
$recognizer.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
$recognizer.SetInputToDefaultAudioDevice()
$result = $recognizer.Recognize([TimeSpan]::FromSeconds(8))
if ($result -and $result.Text) {
  Write-Output $result.Text
}
'''.strip()

        proc = self._run_hidden_powershell(ps_script, timeout=14)
        if proc.returncode != 0:
            stderr = (proc.stderr or "").strip()
            raise RuntimeError(stderr or "Windows speech recognition failed. Ensure microphone access is enabled in Windows Privacy settings.")
        text = (proc.stdout or "").strip()
        if not text:
            raise RuntimeError("No speech recognized. Try again closer to the microphone.")
        return text

    def _speak_text_windows(self, text: str):
        safe = (text or "").strip()
        if not safe:
            return

        safe = safe.replace("'", "''")
        ps_script = f"""
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.Rate = 0
$synth.Volume = 90
$synth.Speak('{safe}')
""".strip()

        proc = self._run_hidden_powershell(ps_script, timeout=30)
        if proc.returncode != 0:
            stderr = (proc.stderr or "").strip()
            raise RuntimeError(stderr or "Voice playback failed")

    def _sanitize_project_relpath(self, raw_path: str) -> str:
        rel = (raw_path or "").strip().replace("\\", "/")
        if not rel:
            raise ValueError("Path is empty")
        while rel.startswith("/"):
            rel = rel[1:]
        if not rel:
            raise ValueError("Path cannot target project root directly")

        abs_path = (self.root_dir / rel).resolve()
        root_abs = self.root_dir.resolve()
        if os.path.commonpath([str(root_abs), str(abs_path)]) != str(root_abs):
            raise ValueError("Path escapes project root")

        return abs_path.relative_to(root_abs).as_posix()

    def _mycomputer_project_tree(self) -> str:
        files = []
        for path in self.root_dir.rglob("*.young"):
            parts = set(path.parts)
            if "__pycache__" in parts or ".venv" in parts:
                continue
            if "native" in parts and "build" in parts:
                continue
            rel = path.relative_to(self.root_dir).as_posix()
            size = path.stat().st_size
            files.append(f"/{rel} ({size} bytes)")

        if not files:
            return "(no .young files yet)"
        return "\n".join(sorted(files))

    def _mycomputer_apply_action(self, action: dict):
        operation = (action.get("action") or "").strip().lower()
        base_path = (action.get("path") or "/").strip()
        name = (action.get("name") or "").strip()
        content = action.get("content") or ""

        try:
            if operation == "list":
                return True, "LIST_OK\n" + self._mycomputer_project_tree()

            if name:
                full = f"{base_path.rstrip('/')}/{name}" if base_path not in ("", "/") else f"/{name}"
            else:
                full = base_path

            rel = self._sanitize_project_relpath(full)
            if not rel.lower().endswith(".young"):
                return False, f"Only .young files are allowed: /{rel}"

            abs_path = self.root_dir / rel
            if operation == "create":
                if abs_path.exists():
                    return False, f"File already exists: /{rel}"
                abs_path.parent.mkdir(parents=True, exist_ok=True)
                abs_path.write_text(content, encoding="utf-8")
                return True, f"CREATE_OK /{rel} ({len(content)} chars)"

            if operation == "read":
                if not abs_path.exists():
                    return False, f"File not found: /{rel}"
                data = abs_path.read_text(encoding="utf-8", errors="ignore")
                return True, f"READ_OK /{rel}\n{data[:8000]}"

            if operation == "update":
                if not abs_path.exists():
                    return False, f"File not found: /{rel}"
                abs_path.write_text(content, encoding="utf-8")
                return True, f"UPDATE_OK /{rel} ({len(content)} chars)"

            return False, f"Unsupported action: {operation}"
        except Exception as ex:
            return False, f"Action failed ({operation}): {ex}"

    def _parse_file_actions(self, text: str):
        actions = []
        chunks = text.split("[FILE_ACTION:")
        for chunk in chunks[1:]:
            end_idx = chunk.find("]")
            block = chunk if end_idx == -1 else chunk[:end_idx]
            pipes = block.split("|")
            if len(pipes) < 1:
                continue
            action = (pipes[0] or "").strip().lower()
            path = (pipes[1] if len(pipes) > 1 else "/").strip() or "/"
            name = (pipes[2] if len(pipes) > 2 else "").strip()
            item_type = (pipes[3] if len(pipes) > 3 else "file").strip().lower() or "file"
            content = "|".join(pipes[4:]).strip() if len(pipes) > 4 else ""
            if action:
                actions.append({
                    "action": action,
                    "path": path,
                    "name": name,
                    "type": item_type,
                    "content": content,
                })
        return actions

    def _strip_file_actions(self, text: str) -> str:
        visible = text.split("[FILE_ACTION:")[0].strip()
        return re.sub(r"FILE_ACTION\s*:[^\n]*", "", visible).strip()

    def _build_live_prompt(self, user_message: str, tool_feedback: str = "") -> str:
        history = []
        for item in self.live_history[-10:]:
            role = item.get("role", "assistant").upper()
            content = item.get("content", "")
            history.append(f"{role}: {content}")

        sections = [
            "You are Young Live Agent running in a local .young project.",
            "Keep answers practical, short, and execution-oriented.",
            "",
            "MyComputer object capabilities (project-scoped):",
            "- create/read/update/list only",
            "- only files inside this project root",
            "- only .young files for create/read/update",
            "",
            "If you need a file operation, emit one or more lines at the end using exactly this format:",
            "[FILE_ACTION:create|/folder|name.young|file|content]",
            "[FILE_ACTION:read|/folder|name.young|file|]",
            "[FILE_ACTION:update|/folder|name.young|file|new content]",
            "[FILE_ACTION:list|/|||]",
            "",
            "Do not explain FILE_ACTION syntax to the user.",
            "",
            "Current .young tree:",
            self._mycomputer_project_tree(),
            "",
            "Conversation so far:",
            "\n".join(history) if history else "(empty)",
            "",
            f"USER: {user_message}",
        ]

        if tool_feedback:
            sections.extend([
                "",
                "TOOL_RESULTS:",
                tool_feedback,
                "",
                "Continue. If task is complete, return the final user-facing answer without any FILE_ACTION.",
            ])

        return "\n".join(sections).strip()

    def _run_live_turn(self, user_message: str):
        pending_user = user_message
        tool_feedback = ""
        final_text = ""
        action_log = []

        for _ in range(5):
            prompt = self._build_live_prompt(pending_user, tool_feedback)
            ok, response, err = self._call_claude_native(prompt, timeout=180)
            if not ok:
                return False, "", err

            actions = self._parse_file_actions(response)
            visible = self._strip_file_actions(response)
            if visible:
                final_text = visible

            if not actions:
                return True, final_text or "(no response)", "\n".join(action_log)

            tool_lines = []
            for action in actions:
                ok_action, result = self._mycomputer_apply_action(action)
                status = "OK" if ok_action else "ERROR"
                tool_lines.append(f"{status}: {result}")
                action_log.append(f"{action.get('action','').upper()} -> {result}")

            tool_feedback = "\n".join(tool_lines)
            pending_user = "Use the tool results and continue."

        if not final_text:
            final_text = "Reached live tool-step limit."
        return True, final_text, "\n".join(action_log)

    def on_browse_script(self):
        file_path = filedialog.askopenfilename(
            title="Select a Young Script",
            initialdir=str(self.root_dir),
            filetypes=[("Young files", "*.young"), ("All files", "*.*")],
        )
        if file_path:
            self.script_path_var.set(file_path)

    def on_run_young(self):
        script_path = Path(self.script_path_var.get()).expanduser()
        if not script_path.exists():
            messagebox.showerror("Missing file", f"Young file not found:\n{script_path}")
            return

        self._set_status("Running Young script...")

        def task():
            buf = io.StringIO()
            try:
                src = script_path.read_text(encoding="utf-8")
                with contextlib.redirect_stdout(buf):
                    code = run_young(src)
                output = buf.getvalue().strip()
                lines = [f"File: {script_path}"]
                if output:
                    lines.append(output)
                lines.append(f"Exit code: {code}")
                result = "\n".join(lines)
                self.last_young_output = result
                self.after(0, lambda: self._set_text(self.young_output_text, result))
                self.after(0, lambda: self._set_status("Young run completed"))
            except Exception:
                err = traceback.format_exc()
                self.after(0, lambda: self._set_text(self.young_output_text, err))
                self.after(0, lambda: self._set_status("Young run failed"))

        threading.Thread(target=task, daemon=True).start()

    def _native_exe_candidates(self):
        override = os.environ.get("YOUNG_NATIVE_EXE", "").strip()
        candidates = []
        if override:
            candidates.append(Path(override).expanduser())

        candidates.extend([
            self.root_dir / "native" / "build" / "Release" / "young_haiku_cli.exe",
            self.root_dir / "native" / "build" / "Debug" / "young_haiku_cli.exe",
            self.root_dir / "native" / "build" / "young_haiku_cli.exe",
        ])
        return candidates

    def _find_native_exe(self):
        for candidate in self._native_exe_candidates():
            if candidate.exists():
                return candidate

        build_dir = self.root_dir / "native" / "build"
        if build_dir.exists():
            for candidate in build_dir.rglob("young_haiku_cli*.exe"):
                if candidate.is_file():
                    return candidate
        return None

    def _build_native_binary(self):
        configure = subprocess.run(
            ["cmake", "-S", "native", "-B", "native/build"],
            cwd=self.root_dir,
            text=True,
            capture_output=True,
            timeout=240,
        )
        build = subprocess.run(
            ["cmake", "--build", "native/build", "--config", "Release"],
            cwd=self.root_dir,
            text=True,
            capture_output=True,
            timeout=240,
        )

        exe = self._find_native_exe()
        lines = [
            "== CMake Configure ==",
            configure.stdout.strip(),
            configure.stderr.strip(),
            "",
            "== CMake Build ==",
            build.stdout.strip(),
            build.stderr.strip(),
        ]
        if exe is None:
            lines.extend([
                "",
                "== Binary Search ==",
                "Could not find young_haiku_cli.exe in expected locations:",
            ])
            lines.extend(str(p) for p in self._native_exe_candidates())
            lines.append(str(self.root_dir / "native" / "build" / "**" / "young_haiku_cli*.exe"))

        combined = "\n".join(lines).strip()
        success = configure.returncode == 0 and build.returncode == 0 and exe is not None
        return success, exe, combined

    def on_build_native(self):
        self._set_status("Building native Claude binary...")

        def task():
            try:
                ok, exe, combined = self._build_native_binary()
                self.after(0, lambda: self._set_text(self.claude_output_text, combined))

                if ok:
                    self.after(0, lambda: self._set_status(f"Native build completed ({exe.name})"))
                else:
                    self.after(0, lambda: self._set_status("Native build failed"))
            except Exception:
                err = traceback.format_exc()
                self.after(0, lambda: self._set_text(self.claude_output_text, err))
                self.after(0, lambda: self._set_status("Native build failed"))

        threading.Thread(target=task, daemon=True).start()

    def on_interpret_output(self):
        if not self.last_young_output:
            messagebox.showinfo("No output", "Run a Young script first.")
            return

        prompt = (
            "Interpret this Young runtime result briefly with tarot and Jung logic.\n\n"
            f"{self.last_young_output}"
        )
        self.prompt_text.delete("1.0", tk.END)
        self.prompt_text.insert("1.0", prompt)
        self.on_ask_claude()

    def _scaffold_for_current_settings(self) -> str:
        goal = (self.goal_var.get() or "Build symbolic flow").strip()
        arcana = (self.arcana_var.get() or "IX - THE HERMIT").strip()
        complexity = (self.complexity_var.get() or "balanced").strip()
        constraints = (self.constraints_var.get() or "Keep runtime deterministic.").strip()
        safe_goal = goal.replace('"', "'")
        safe_arcana = arcana.replace('"', "'")
        safe_constraints = constraints.replace('"', "'")

        return "\n".join([
            "# Young scaffold generated by Young Composer",
            f"# goal: {goal}",
            f"# arcana: {arcana}",
            f"# complexity: {complexity}",
            "",
            "ritual integrate_shadow(input_value: int) -> int {",
            "    mut tension: int = input_value;",
            "    STRENGTH WHILE tension > 0 {",
            "        tension = tension - 1;",
            "    }",
            "    return input_value;",
            "}",
            "",
            "ritual archetype_loop(seed: int) -> int {",
            "    mut accumulator: int = 0;",
            "    mut index: int = 0;",
            "    STRENGTH WHILE index < seed {",
            "        accumulator = accumulator + index;",
            "        index = index + 1;",
            "    }",
            "    return accumulator;",
            "}",
            "",
            "ritual main() -> int {",
            "    mut consciousness: int = 3;",
            "    mut shadow: int = 7;",
            "    mut synthesis: int = 0;",
            "",
            "    CHARIOT IF shadow > consciousness {",
            "        synthesis = integrate_shadow(shadow);",
            "    } ELSE {",
            "        synthesis = consciousness;",
            "    }",
            "",
            "    synthesis = synthesis + archetype_loop(consciousness);",
            f"    HIEROPHANT print(\"goal={safe_goal}\");",
            f"    HIEROPHANT print(\"arcana={safe_arcana}\");",
            f"    HIEROPHANT print(\"constraints={safe_constraints}\");",
            "    HIEROPHANT print(\"result=\" + str(synthesis));",
            "    return 0;",
            "}",
            "",
        ])

    def on_insert_young_scaffold(self):
        script_path = Path(self.script_path_var.get()).expanduser()
        if script_path.exists():
            existing = script_path.read_text(encoding="utf-8", errors="ignore")
            if existing.strip():
                should_overwrite = messagebox.askyesno(
                    "Overwrite file",
                    f"{script_path.name} already has content. Replace with generated scaffold?",
                )
                if not should_overwrite:
                    return

        scaffold = self._scaffold_for_current_settings()
        script_path.write_text(scaffold, encoding="utf-8")
        self._set_text(self.young_output_text, f"Scaffold written to:\n{script_path}\n\n{scaffold}")
        self._set_status(".young scaffold generated")

    def on_build_coding_prompt(self):
        goal = (self.goal_var.get() or "Build symbolic flow").strip()
        arcana = (self.arcana_var.get() or "IX - THE HERMIT").strip()
        complexity = (self.complexity_var.get() or "balanced").strip()
        constraints = (self.constraints_var.get() or "Keep runtime deterministic.").strip()

        complexity_hint = {
            "cheap": "Target lower token usage and compact code. Keep the number of rituals small.",
            "balanced": "Return clear runnable code with short explanation and practical naming.",
            "rich": "Return richer multi-ritual architecture, still runnable and coherent.",
        }.get(complexity, "Return clear runnable code.")

        prompt = "\n".join([
            "You are generating .young source code in a Jungian-tarot assembly style.",
            f"Task: {goal}",
            f"Arcana focus: {arcana}",
            f"Constraints: {constraints}",
            complexity_hint,
            "",
            "Output contract:",
            "1) Provide one complete .young file first.",
            "2) Then provide 4 short bullets explaining architecture choices.",
            "",
            "Language requirements:",
            "- Define ritual main() -> int.",
            "- Use ritual functions for modular structure.",
            "- Include control flow with CHARIOT IF or STRENGTH WHILE.",
            "- Use HIEROPHANT print for visible runtime traces.",
            "- Keep syntax compatible with the Young runtime parser.",
            "",
            "Psychological framing requirements:",
            "- Map at least 3 Jungian concepts into variables or ritual names (shadow, anima, self, individuation).",
            "- Reflect tarot arcana symbolism in naming and branch logic.",
            "- Keep it practical: this must execute, not just be poetic.",
        ])

        self.prompt_text.delete("1.0", tk.END)
        self.prompt_text.insert("1.0", prompt)
        self._set_status("Coding prompt generated")

    def on_ask_claude(self):
        prompt = self.prompt_text.get("1.0", tk.END).strip()
        if not prompt:
            messagebox.showerror("Missing prompt", "Enter a prompt for Claude.")
            return

        exe_path = self._find_native_exe()
        if exe_path is None:
            should_build = messagebox.askyesno(
                "Native binary missing",
                "Could not find young_haiku_cli.exe. Build Native now?",
            )
            if not should_build:
                return

        typed_api_key = self._normalize_api_key(self.api_key_var.get())
        env_api_key = self._normalize_api_key(os.environ.get("ANTHROPIC_API_KEY", ""))
        api_key = typed_api_key or env_api_key
        if not api_key:
            messagebox.showerror("Missing API key", "Set ANTHROPIC_API_KEY or enter it in the GUI.")
            return

        # Keep the field normalized to avoid hidden trailing spaces/newlines from copy-paste.
        if typed_api_key and typed_api_key != self.api_key_var.get():
            self.api_key_var.set(typed_api_key)

        self._set_status("Calling Claude Haiku...")

        def task():
            try:
                ok, response, err = self._call_claude_native(prompt, timeout=180)
                if not ok:
                    self.after(0, lambda: self._set_text(self.claude_output_text, err))
                    self.after(0, lambda: self._set_status("Claude call failed"))
                    return
                self.after(0, lambda: self._set_text(self.claude_output_text, response))
                self.after(0, lambda: self._set_status("Claude response received"))
            except Exception:
                err = traceback.format_exc()
                self.after(0, lambda: self._set_text(self.claude_output_text, err))
                self.after(0, lambda: self._set_status("Claude call failed"))

        threading.Thread(target=task, daemon=True).start()

    def on_live_clear(self):
        self.live_history = []
        self._set_text(self.live_output_text, "")
        self._set_status("Live session cleared")

    def on_live_mic(self):
        if hasattr(self, "tabs"):
            self.tabs.select(2)
        if self.is_live_busy:
            messagebox.showinfo("Live busy", "Wait for the current live request to finish.")
            return
        if sys.platform != "win32":
            messagebox.showinfo("Microphone", "Microphone capture is currently implemented for Windows only.")
            return

        self._set_status("Listening on microphone (8s)...")

        def task():
            try:
                text = self._capture_mic_text_windows()
                self.after(0, lambda: self.live_input_var.set(text))
                self.after(0, lambda: self._set_status("Microphone text captured"))
            except Exception as ex:
                self.after(0, lambda: self._set_status("Microphone capture failed"))
                self.after(0, lambda ex=ex: messagebox.showerror("Microphone", str(ex)))

        threading.Thread(target=task, daemon=True).start()

    def on_live_send(self):
        if self.is_live_busy:
            messagebox.showinfo("Live busy", "Wait for the current live request to finish.")
            return

        text = (self.live_input_var.get() or "").strip()
        if not text:
            messagebox.showinfo("Live input", "Type a message for Live Agent.")
            return

        self.is_live_busy = True
        self.live_input_var.set("")
        self._live_append("USER", text)
        self._set_status("Live Agent thinking...")

        def task():
            try:
                self.live_history.append({"role": "user", "content": text})
                ok, answer, actions = self._run_live_turn(text)
                if not ok:
                    self.after(0, lambda: self._live_append("SYSTEM", actions))
                    self.after(0, lambda: self._set_status("Live Agent failed"))
                    return

                if actions:
                    self.after(0, lambda: self._live_append("MYCOMPUTER", actions))

                self.live_history.append({"role": "assistant", "content": answer})
                self.after(0, lambda: self._live_append("ASSISTANT", answer))
                self.after(0, lambda: self._set_status("Live Agent response received"))
                if sys.platform == "win32" and self.live_voice_var.get():
                    try:
                        self._speak_text_windows(answer[:500])
                    except Exception:
                        pass
            except Exception:
                err = traceback.format_exc()
                self.after(0, lambda: self._live_append("SYSTEM", err))
                self.after(0, lambda: self._set_status("Live Agent failed"))
            finally:
                self.is_live_busy = False

        threading.Thread(target=task, daemon=True).start()


def main():
    app = YoungGui()
    app.mainloop()


if __name__ == "__main__":
    main()

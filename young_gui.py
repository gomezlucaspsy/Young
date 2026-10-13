import os
import re
import subprocess
import sys
import threading
import traceback
from pathlib import Path

import young_pc_actions
import tkinter as tk
from tkinter import messagebox, simpledialog, ttk

from young_runner import run_report as run_young_report


class YoungGui(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Young - Oracle Live")
        self.geometry("1100x720")
        self.minsize(860, 560)

        self.root_dir = Path(__file__).resolve().parent
        self.selected_file = None
        self._settings_win = None

        self.api_key_var = tk.StringVar(value=os.environ.get("ANTHROPIC_API_KEY", ""))
        self.status_var = tk.StringVar(value="Ready")
        self.live_input_var = tk.StringVar(value="")
        self.live_voice_var = tk.BooleanVar(value=True)
        self.live_history = []
        self.is_live_busy = False

        self._apply_color_theme()
        self._build_layout()

    def _apply_color_theme(self):
        # Matches web/app/globals.css so all three Young surfaces (native/Python/web)
        # read as one product: dark bg, gold wordmark/highlights, violet primary action.
        self.configure(bg="#08070c")

        style = ttk.Style(self)
        try:
            style.theme_use("clam")
        except tk.TclError:
            pass

        style.configure("TFrame", background="#08070c")
        style.configure("TLabel", background="#08070c", foreground="#e8e3f0")
        style.configure("Title.TLabel", background="#08070c", foreground="#c9a24b", font=("Cambria", 20, "bold"))
        style.configure("Section.TLabel", background="#08070c", foreground="#8b8799", font=("Segoe UI", 9, "bold"))
        style.configure("Hint.TLabel", background="#08070c", foreground="#8b8799")
        style.configure("TButton", background="#1a1722", foreground="#e8e3f0", padding=(10, 6), borderwidth=0)
        style.map("TButton", background=[("active", "#241f30")])
        style.configure("Accent.TButton", background="#7c5cff", foreground="#ffffff", padding=(10, 6), borderwidth=0)
        style.map("Accent.TButton", background=[("active", "#8f74ff")])
        style.configure("Danger.TButton", background="#3a1620", foreground="#f87171", padding=(10, 6), borderwidth=0)
        style.map("Danger.TButton", background=[("active", "#4a1c29")])
        style.configure("TEntry", fieldbackground="#0d0b14", foreground="#e8e3f0", insertcolor="#e8e3f0")
        style.configure("TCheckbutton", background="#08070c", foreground="#e8e3f0")

    def _build_layout(self):
        # One consolidated chat-first view (no tabs) — mirrors web/app/live: a
        # transcript + MyComputer file panel + input row, with everything else
        # (API key, voice toggle, rebuild binary) tucked behind one Settings dialog.
        self.columnconfigure(0, weight=1)
        self.rowconfigure(1, weight=1)

        header = ttk.Frame(self, padding=(14, 12, 14, 6))
        header.grid(row=0, column=0, sticky="ew")
        header.columnconfigure(0, weight=1)
        ttk.Label(header, text="YOUNG", style="Title.TLabel").grid(row=0, column=0, sticky="w")
        ttk.Button(header, text="Settings", command=self.on_open_settings).grid(row=0, column=1, sticky="e")

        main = ttk.Panedwindow(self, orient=tk.HORIZONTAL)
        main.grid(row=1, column=0, sticky="nsew", padx=14, pady=(0, 6))

        # Left: chat
        chat = ttk.Frame(main, padding=(0, 0, 8, 0))
        chat.columnconfigure(0, weight=1)
        chat.rowconfigure(0, weight=1)
        main.add(chat, weight=3)

        self.live_output_text = tk.Text(chat, wrap="word")
        self.live_output_text.grid(row=0, column=0, sticky="nsew")
        self.live_output_text.configure(bg="#0b0912", fg="#e8e3f0", insertbackground="#7c5cff", relief="flat")

        input_row = ttk.Frame(chat)
        input_row.grid(row=1, column=0, sticky="ew", pady=(8, 0))
        input_row.columnconfigure(0, weight=1)
        self.live_input_entry = ttk.Entry(input_row, textvariable=self.live_input_var)
        self.live_input_entry.grid(row=0, column=0, sticky="ew", padx=(0, 8))
        self.live_input_entry.bind("<Return>", self._on_live_enter)
        ttk.Button(input_row, text="Mic", command=self.on_live_mic).grid(row=0, column=1, padx=(0, 8))
        ttk.Button(input_row, text="Enviar", command=self.on_live_send, style="Accent.TButton").grid(row=0, column=2)

        # Right: MyComputer file panel
        panel = ttk.Frame(main, padding=(8, 0, 0, 0))
        panel.columnconfigure(0, weight=1)
        panel.rowconfigure(2, weight=1)
        main.add(panel, weight=2)

        panel_head = ttk.Frame(panel)
        panel_head.grid(row=0, column=0, sticky="ew")
        panel_head.columnconfigure(0, weight=1)
        ttk.Label(panel_head, text="MYCOMPUTER", style="Section.TLabel").grid(row=0, column=0, sticky="w")
        ttk.Button(panel_head, text="+ Nuevo", command=self.on_file_new).grid(row=0, column=1, sticky="e")

        self.file_listbox = tk.Listbox(panel, height=8, exportselection=False)
        self.file_listbox.grid(row=1, column=0, sticky="new", pady=(6, 6))
        self.file_listbox.configure(bg="#0d0b14", fg="#e8e3f0", relief="flat", highlightthickness=0)
        self.file_listbox.bind("<<ListboxSelect>>", self.on_file_select)

        self.file_editor = tk.Text(panel, wrap="none", height=14)
        self.file_editor.grid(row=2, column=0, sticky="nsew")
        self.file_editor.configure(bg="#0d0b14", fg="#e8e3f0", insertbackground="#c9a24b", relief="flat")

        file_actions = ttk.Frame(panel)
        file_actions.grid(row=3, column=0, sticky="ew", pady=(6, 0))
        file_actions.columnconfigure((0, 1, 2), weight=1)
        ttk.Button(file_actions, text="Guardar", command=self.on_file_save).grid(row=0, column=0, sticky="ew", padx=(0, 4))
        ttk.Button(file_actions, text="Run", command=self.on_file_run, style="Accent.TButton").grid(row=0, column=1, sticky="ew", padx=4)
        ttk.Button(file_actions, text="Borrar", command=self.on_file_delete, style="Danger.TButton").grid(row=0, column=2, sticky="ew", padx=(4, 0))

        status = ttk.Label(self, textvariable=self.status_var, anchor="w", padding=(14, 6))
        status.grid(row=2, column=0, sticky="ew")

        self._refresh_file_list()

    # ── MyComputer file panel ────────────────────────────────────────────────

    def _list_young_files(self):
        files = []
        for path in self.root_dir.rglob("*.young"):
            parts = set(path.parts)
            if "__pycache__" in parts or ".venv" in parts:
                continue
            if "native" in parts and "build" in parts:
                continue
            files.append(path.relative_to(self.root_dir).as_posix())
        return sorted(files)

    def _refresh_file_list(self):
        self.file_listbox.delete(0, tk.END)
        for rel in self._list_young_files():
            self.file_listbox.insert(tk.END, rel)

    def on_file_select(self, _event=None):
        selection = self.file_listbox.curselection()
        if not selection:
            return
        rel = self.file_listbox.get(selection[0])
        self.selected_file = rel
        try:
            content = (self.root_dir / rel).read_text(encoding="utf-8", errors="ignore")
        except OSError:
            content = ""
        self._set_text(self.file_editor, content)

    def on_file_new(self):
        name = simpledialog.askstring(
            "Nuevo archivo", "Nombre (.young):", initialvalue="ritual_new.young", parent=self
        )
        if not name:
            return
        ok, result = self._mycomputer_apply_action({"action": "create", "path": "/", "name": name, "content": ""})
        self._set_status(result)
        self._refresh_file_list()
        if ok:
            rel = name.lstrip("/")
            files = self._list_young_files()
            if rel in files:
                idx = files.index(rel)
                self.file_listbox.selection_clear(0, tk.END)
                self.file_listbox.selection_set(idx)
                self.on_file_select()

    def on_file_save(self):
        if not self.selected_file:
            self._set_status("No file selected.")
            return
        content = self.file_editor.get("1.0", tk.END).rstrip("\n")
        ok, result = self._mycomputer_apply_action(
            {"action": "update", "path": "/", "name": self.selected_file, "content": content}
        )
        self._set_status(result)

    def on_file_run(self):
        if not self.selected_file:
            self._set_status("No file selected.")
            return
        script_path = self.root_dir / self.selected_file
        rel = self.selected_file
        self._set_status(f"Running {rel}...")

        def task():
            try:
                src = script_path.read_text(encoding="utf-8")
            except OSError as ex:
                self.after(0, lambda ex=ex: self._live_append("RUN ERROR", str(ex)))
                self.after(0, lambda: self._set_status("Ready"))
                return
            report = run_young_report(src, filename=rel, timeout_s=30)
            if report.ok:
                output = report.output.strip() or "(no output)"
                self.after(0, lambda: self._live_append("RUN", f"{rel}\n{output}\nExit code: {report.exit_code}"))
            else:
                # Located Young error (file:line:col, caret, ritual stack), not a Python traceback.
                self.after(0, lambda: self._live_append("RUN ERROR", report.as_text()))
            self.after(0, lambda: self._set_status("Ready" if report.ok else "Run failed — see Live log"))

        threading.Thread(target=task, daemon=True).start()

    def on_file_delete(self):
        if not self.selected_file:
            self._set_status("No file selected.")
            return
        rel = self.selected_file
        if not messagebox.askyesno("Confirmar borrado", f"¿Borrar {rel}?"):
            return
        try:
            (self.root_dir / rel).unlink()
            self._set_status(f"OK: deleted /{rel}")
        except OSError as ex:
            self._set_status(f"ERROR: {ex}")
        self.selected_file = None
        self._set_text(self.file_editor, "")
        self._refresh_file_list()

    # ── Settings dialog (API key, voice toggle, rebuild binary — everything
    #    rarely touched lives here instead of cluttering the main view) ──────

    def on_open_settings(self):
        if self._settings_win is not None and self._settings_win.winfo_exists():
            self._settings_win.deiconify()
            self._settings_win.lift()
            return

        win = tk.Toplevel(self)
        self._settings_win = win
        win.title("Settings")
        win.configure(bg="#08070c")
        win.transient(self)
        win.resizable(False, False)

        frame = ttk.Frame(win, padding=14)
        frame.grid(row=0, column=0, sticky="nsew")

        ttk.Label(frame, text="ANTHROPIC_API_KEY").grid(row=0, column=0, sticky="w")
        ttk.Entry(frame, textvariable=self.api_key_var, show="*", width=40).grid(
            row=1, column=0, sticky="ew", pady=(4, 12)
        )
        ttk.Checkbutton(frame, text="Voice reply (TTS)", variable=self.live_voice_var).grid(
            row=2, column=0, sticky="w", pady=(0, 12)
        )
        ttk.Button(frame, text="Limpiar chat", command=self.on_live_clear).grid(
            row=3, column=0, sticky="ew", pady=(0, 8)
        )
        ttk.Button(frame, text="Rebuild native binary", command=self.on_build_native).grid(
            row=4, column=0, sticky="ew", pady=(0, 12)
        )
        ttk.Button(frame, text="Close", command=win.destroy, style="Accent.TButton").grid(row=5, column=0, sticky="ew")

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
        visible = text.split("[FILE_ACTION:")[0]
        visible = visible.split("[PC_ACTION:")[0].strip()
        visible = re.sub(r"FILE_ACTION\s*:[^\n]*", "", visible)
        visible = re.sub(r"PC_ACTION\s*:[^\n]*", "", visible)
        return visible.strip()

    def _try_fallback_file_action(self, visible_text: str):
        """Recover a create the model narrated but forgot to tag with FILE_ACTION:
        a bare *.young filename plus a fenced code block is enough to act on."""
        name_match = re.search(r"\b[A-Za-z0-9_\-]+\.young\b", visible_text)
        if not name_match:
            return None
        fence_match = re.search(r"```[a-zA-Z]*\n(.*?)```", visible_text, re.DOTALL)
        if not fence_match:
            return None
        content = fence_match.group(1).strip()
        if not content:
            return None
        return {
            "action": "create",
            "path": "/",
            "name": name_match.group(0),
            "type": "file",
            "content": content,
        }

    def _parse_pc_actions(self, text: str):
        actions = []
        chunks = text.split("[PC_ACTION:")
        for chunk in chunks[1:]:
            end_idx = chunk.find("]")
            block = chunk if end_idx == -1 else chunk[:end_idx]
            parts = block.split("|", 1)
            ptype = (parts[0] or "").strip().lower()
            param = parts[1].strip() if len(parts) > 1 else ""
            if ptype:
                actions.append({"type": ptype, "param": param})
        return actions

    def _execute_pc_action(self, ptype: str, param: str) -> str:
        """The ONLY five PC_ACTION types that exist — no generic shell/run-command action.
        Delegates to young_pc_actions so the local Live tab and young_host_agent.py
        (driven remotely by the Web Live control-plane) behave identically."""
        return young_pc_actions.execute_pc_action(self.root_dir, ptype, param)

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
            "You can also check on or act within the real machine through a small FIXED set of",
            "PC_ACTION commands. There is no generic shell/run-command action — only these five:",
            "[PC_ACTION:status|]              disk free/total + OS info, no param",
            "[PC_ACTION:list_processes|]      read-only process snapshot, no param",
            "[PC_ACTION:open_folder|]         opens the project root in the file explorer, no param",
            "[PC_ACTION:run_young|name.young] runs an existing project script, returns its output",
            "[PC_ACTION:read_repo|<github url or owner/repo>[@branch][|path/to/file]]",
            "    no path -> lists the repo's file tree; with a path -> reads that file's content.",
            "    Use this whenever the user gives you a GitHub link and wants you to read/explain it.",
            "",
            "Do not explain FILE_ACTION or PC_ACTION syntax to the user.",
            "",
            "Work autonomously until the task is done: after you create or update a .young file,",
            "verify it with [PC_ACTION:run_young|name.young]. If the result is an ERROR (it names the",
            "line, shows the code and the ritual call stack), fix that file and run it again.",
            "Only give the final answer once it runs cleanly or you clearly explain what still fails.",
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

            used_fallback = False
            if not actions:
                fallback = self._try_fallback_file_action(visible)
                if fallback:
                    actions = [fallback]
                    used_fallback = True

            pc_actions = self._parse_pc_actions(response)

            if not actions and not pc_actions:
                return True, final_text or "(no response)", "\n".join(action_log)

            tool_lines = []
            for i, action in enumerate(actions):
                ok_action, result = self._mycomputer_apply_action(action)
                status = "OK" if ok_action else "ERROR"
                tool_lines.append(f"{status}: {result}")
                label = action.get("action", "").upper()
                if used_fallback and i == 0:
                    label = f"AUTO-DETECTED {label}"
                action_log.append(f"{label} -> {result}")

            for pc_action in pc_actions:
                ptype = pc_action.get("type", "")
                param = pc_action.get("param", "")
                result = self._execute_pc_action(ptype, param)
                tool_lines.append(f"PC_ACTION {ptype}: {result}")
                action_log.append(f"PC_ACTION {ptype}({param}) -> {result}")

            tool_feedback = "\n".join(tool_lines)
            pending_user = "Use the tool results and continue."

        if not final_text:
            final_text = "Reached live tool-step limit."
        return True, final_text, "\n".join(action_log)

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
                self.after(0, lambda: self._live_append("BUILD", combined))
                if ok:
                    self.after(0, lambda: self._set_status(f"Native build completed ({exe.name})"))
                else:
                    self.after(0, lambda: self._set_status("Native build failed"))
            except Exception:
                err = traceback.format_exc()
                self.after(0, lambda: self._live_append("BUILD ERROR", err))
                self.after(0, lambda: self._set_status("Native build failed"))

        threading.Thread(target=task, daemon=True).start()

    def on_live_clear(self):
        self.live_history = []
        self._set_text(self.live_output_text, "")
        self._set_status("Live session cleared")

    def on_live_mic(self):
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

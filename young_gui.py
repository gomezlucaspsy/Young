import contextlib
import io
import os
import subprocess
import threading
import traceback
from pathlib import Path
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

from young_runner import run as run_young


class YoungGui(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Young Studio")
        self.geometry("1180x760")
        self.minsize(980, 640)

        self.root_dir = Path(__file__).resolve().parent
        self.last_young_output = ""

        self.script_path_var = tk.StringVar(value=str(self._default_script_path()))
        self.api_key_var = tk.StringVar(value=os.environ.get("ANTHROPIC_API_KEY", ""))
        self.status_var = tk.StringVar(value="Ready")
        self.goal_var = tk.StringVar(value="Build a symbolic analyzer with shadow integration")
        self.arcana_var = tk.StringVar(value="IX - THE HERMIT")
        self.complexity_var = tk.StringVar(value="balanced")
        self.constraints_var = tk.StringVar(value="Keep runtime deterministic and under O(n).")

        self._build_layout()

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

        top = ttk.Frame(self, padding=(12, 10))
        top.grid(row=0, column=0, sticky="ew")
        top.columnconfigure(1, weight=1)

        ttk.Label(top, text="Young File").grid(row=0, column=0, sticky="w")
        ttk.Entry(top, textvariable=self.script_path_var).grid(row=0, column=1, sticky="ew", padx=8)
        ttk.Button(top, text="Browse", command=self.on_browse_script).grid(row=0, column=2, padx=(0, 8))
        ttk.Button(top, text="Run Young", command=self.on_run_young).grid(row=0, column=3, padx=(0, 8))
        ttk.Button(top, text="Build Native", command=self.on_build_native).grid(row=0, column=4)

        key_frame = ttk.Frame(self, padding=(12, 0, 12, 10))
        key_frame.grid(row=1, column=0, sticky="ew")
        key_frame.columnconfigure(1, weight=1)
        ttk.Label(key_frame, text="Anthropic API Key").grid(row=0, column=0, sticky="w")
        ttk.Entry(key_frame, textvariable=self.api_key_var, show="*").grid(row=0, column=1, sticky="ew", padx=8)
        ttk.Label(
            key_frame,
            text="The key is only used in-memory for this app process.",
            foreground="#555555",
        ).grid(row=0, column=2, sticky="w")

        main = ttk.Panedwindow(self, orient=tk.HORIZONTAL)
        main.grid(row=2, column=0, sticky="nsew", padx=12, pady=6)

        left = ttk.Frame(main, padding=8)
        left.columnconfigure(0, weight=1)
        left.rowconfigure(1, weight=1)

        right = ttk.Frame(main, padding=8)
        right.columnconfigure(0, weight=1)
        right.rowconfigure(1, weight=1)

        main.add(left, weight=1)
        main.add(right, weight=1)

        ttk.Label(left, text="Young Output").grid(row=0, column=0, sticky="w")
        self.young_output_text = tk.Text(left, wrap="word", height=20)
        self.young_output_text.grid(row=1, column=0, sticky="nsew", pady=(6, 0))

        ttk.Label(right, text="Claude Response").grid(row=0, column=0, sticky="w")
        self.claude_output_text = tk.Text(right, wrap="word", height=20)
        self.claude_output_text.grid(row=1, column=0, sticky="nsew", pady=(6, 0))

        prompt = ttk.Frame(self, padding=(12, 6, 12, 6))
        prompt.grid(row=3, column=0, sticky="ew")
        prompt.columnconfigure(0, weight=1)

        composer = ttk.LabelFrame(prompt, text="Young Composer", padding=(8, 6))
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

        ttk.Label(prompt, text="Claude Prompt").grid(row=1, column=0, sticky="w")
        self.prompt_text = tk.Text(prompt, wrap="word", height=8)
        self.prompt_text.grid(row=2, column=0, sticky="ew", pady=(6, 8))

        actions = ttk.Frame(prompt)
        actions.grid(row=3, column=0, sticky="w")
        ttk.Button(actions, text="Ask Claude", command=self.on_ask_claude).grid(row=0, column=0, padx=(0, 8))
        ttk.Button(actions, text="Interpret Young Output", command=self.on_interpret_output).grid(row=0, column=1)

        status = ttk.Label(self, textvariable=self.status_var, anchor="w", padding=(12, 6))
        status.grid(row=4, column=0, sticky="ew")

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
                resolved_exe = exe_path
                if resolved_exe is None:
                    self.after(0, lambda: self._set_status("Building native binary before Claude call..."))
                    ok, built_exe, build_log = self._build_native_binary()
                    self.after(0, lambda: self._set_text(self.claude_output_text, build_log))
                    if not ok or built_exe is None:
                        self.after(0, lambda: self._set_status("Native build failed"))
                        return
                    resolved_exe = built_exe

                env = os.environ.copy()
                env["ANTHROPIC_API_KEY"] = api_key

                def run_call(with_key: str):
                    call_env = dict(env)
                    call_env["ANTHROPIC_API_KEY"] = with_key
                    return subprocess.run(
                        [str(resolved_exe), prompt],
                        cwd=self.root_dir,
                        text=True,
                        capture_output=True,
                        env=call_env,
                        timeout=180,
                    )

                proc = run_call(api_key)

                # If user-entered key is bad but process env has a different key, try once with env key.
                if (
                    proc.returncode != 0
                    and self._is_auth_error(proc.stderr)
                    and typed_api_key
                    and env_api_key
                    and typed_api_key != env_api_key
                ):
                    fallback_proc = run_call(env_api_key)
                    if fallback_proc.returncode == 0:
                        response = fallback_proc.stdout.strip() or "(empty response)"
                        self.after(0, lambda: self._set_text(self.claude_output_text, response))
                        self.after(0, lambda: self._set_status("Claude response received (used env key fallback)"))
                        self.after(0, lambda: self.api_key_var.set(env_api_key))
                        return
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
                    self.after(0, lambda: self._set_text(self.claude_output_text, text))
                    self.after(0, lambda: self._set_status("Claude call failed"))
                    return

                response = proc.stdout.strip() or "(empty response)"
                self.after(0, lambda: self._set_text(self.claude_output_text, response))
                self.after(0, lambda: self._set_status("Claude response received"))
            except Exception:
                err = traceback.format_exc()
                self.after(0, lambda: self._set_text(self.claude_output_text, err))
                self.after(0, lambda: self._set_status("Claude call failed"))

        threading.Thread(target=task, daemon=True).start()


def main():
    app = YoungGui()
    app.mainloop()


if __name__ == "__main__":
    main()

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

        ttk.Label(prompt, text="Claude Prompt").grid(row=0, column=0, sticky="w")
        self.prompt_text = tk.Text(prompt, wrap="word", height=8)
        self.prompt_text.grid(row=1, column=0, sticky="ew", pady=(6, 8))

        actions = ttk.Frame(prompt)
        actions.grid(row=2, column=0, sticky="w")
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

    def _find_native_exe(self):
        candidates = [
            self.root_dir / "native" / "build" / "Release" / "young_haiku_cli.exe",
            self.root_dir / "native" / "build" / "Debug" / "young_haiku_cli.exe",
            self.root_dir / "native" / "build" / "young_haiku_cli.exe",
        ]
        for candidate in candidates:
            if candidate.exists():
                return candidate
        return None

    def on_build_native(self):
        self._set_status("Building native Claude binary...")

        def task():
            try:
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
                combined = "\n".join([
                    "== CMake Configure ==",
                    configure.stdout.strip(),
                    configure.stderr.strip(),
                    "",
                    "== CMake Build ==",
                    build.stdout.strip(),
                    build.stderr.strip(),
                ]).strip()
                self.after(0, lambda: self._set_text(self.claude_output_text, combined))

                if configure.returncode == 0 and build.returncode == 0:
                    self.after(0, lambda: self._set_status("Native build completed"))
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

    def on_ask_claude(self):
        prompt = self.prompt_text.get("1.0", tk.END).strip()
        if not prompt:
            messagebox.showerror("Missing prompt", "Enter a prompt for Claude.")
            return

        exe_path = self._find_native_exe()
        if exe_path is None:
            messagebox.showerror(
                "Native binary missing",
                "Could not find young_haiku_cli.exe. Use Build Native first.",
            )
            return

        api_key = self.api_key_var.get().strip() or os.environ.get("ANTHROPIC_API_KEY", "")
        if not api_key:
            messagebox.showerror("Missing API key", "Set ANTHROPIC_API_KEY or enter it in the GUI.")
            return

        self._set_status("Calling Claude Haiku...")

        def task():
            try:
                env = os.environ.copy()
                env["ANTHROPIC_API_KEY"] = api_key
                proc = subprocess.run(
                    [str(exe_path), prompt],
                    cwd=self.root_dir,
                    text=True,
                    capture_output=True,
                    env=env,
                    timeout=180,
                )
                if proc.returncode != 0:
                    text = f"Claude call failed (code {proc.returncode})\n\n{proc.stderr.strip()}"
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

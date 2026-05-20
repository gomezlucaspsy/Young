# Young Native Claude (Cheap Haiku Defaults)

This folder adds a Windows-native C client for Anthropic Claude with low-cost defaults.

## What is included
- `claude_client.h`: Public API
- `claude_client_winhttp.c`: WinHTTP implementation
- `main.c`: Tiny CLI for testing
- `CMakeLists.txt`: Build file

## Cheap defaults
- Model: `claude-3-5-haiku-latest`
- `max_tokens`: `96`
- `temperature`: `0.2`

These defaults keep costs low while still returning useful output.

## Build (Windows, CMake)
```powershell
cmake -S native -B native/build
cmake --build native/build --config Release
```

## Run
Set your key in the shell first:
```powershell
$env:ANTHROPIC_API_KEY="your_key_here"
```

Run:
```powershell
./native/build/Release/young_haiku_cli.exe "Interpret this symbolic state in one short paragraph"
```

Optional model override:
```powershell
$env:YOUNG_CLAUDE_MODEL="claude-3-5-haiku-latest"
```

## Cost tips
- Keep prompts short and structured.
- Keep `max_tokens` low (64-128 for most calls).
- Use deterministic settings (`temperature` near 0.1-0.3).
- Cache repeated ritual/system prompts on your side.
- Only call Claude for steps that need language inference.

## GUI integration
At the project root, a desktop GUI is available in `young_gui.py`.

Run from root:
```powershell
python young_gui.py
```

Or with launcher:
```powershell
./run-young-gui.bat
```

The GUI can:
- Run `.young` scripts through `young_runner.py` runtime logic.
- Build the native binary using CMake.
- Call Claude through `young_haiku_cli.exe` with your API key.

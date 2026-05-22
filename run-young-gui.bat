@echo off
if "%YOUNG_CLAUDE_MODEL%"=="" set "YOUNG_CLAUDE_MODEL=claude-haiku-4-5"
python young_gui.py

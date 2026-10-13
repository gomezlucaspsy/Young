@echo off
if "%YOUNG_CLAUDE_MODEL%"=="" set "YOUNG_CLAUDE_MODEL=claude-haiku-4-5"
if "%YOUNG_MAX_TOKENS%"=="" set "YOUNG_MAX_TOKENS=1024"
if "%YOUNG_TEMPERATURE%"=="" set "YOUNG_TEMPERATURE=0.2"

set "PYW=pythonw"
if exist ".venv\Scripts\pythonw.exe" set "PYW=.venv\Scripts\pythonw.exe"

start "" "%PYW%" young_gui.py

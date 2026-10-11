@echo off
if "%YOUNG_CLAUDE_MODEL%"=="" set "YOUNG_CLAUDE_MODEL=claude-haiku-4-5"
if "%YOUNG_MAX_TOKENS%"=="" set "YOUNG_MAX_TOKENS=256"
if "%YOUNG_TEMPERATURE%"=="" set "YOUNG_TEMPERATURE=0.3"

set "EXE=native\build\Release\young_studio.exe"
if not exist "%EXE%" set "EXE=native\build\Debug\young_studio.exe"
if exist "%EXE%" goto run

rem First run: build it instead of asking the user to type cmake commands.
where cmake >nul 2>nul
if errorlevel 1 (
    echo Young Studio todavia no esta compilado y no se encontro CMake.
    echo Instala CMake + Visual Studio Build Tools, o usa Young Live en el navegador.
    pause
    exit /b 1
)
echo Compilando Young Studio por primera vez, un momento...
cmake -S native -B native\build >nul && cmake --build native\build --config Release >nul
set "EXE=native\build\Release\young_studio.exe"
if not exist "%EXE%" (
    echo No se pudo compilar. Abri una consola aca y corre run-young-studio.bat para ver el error.
    pause
    exit /b 1
)

:run
start "" "%EXE%"

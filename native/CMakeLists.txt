cmake_minimum_required(VERSION 3.20)
project(young_native_claude C)

# ── CLI tool ─────────────────────────────────────────────────────────────────
add_executable(young_haiku_cli
    main.c
    claude_client_winhttp.c
)
target_compile_features(young_haiku_cli PRIVATE c_std_11)
target_link_libraries(young_haiku_cli PRIVATE winhttp)

# ── Young Studio Live GUI ─────────────────────────────────────────────────────
add_executable(young_studio WIN32
    young_studio.c
    claude_client_winhttp.c
)
target_compile_features(young_studio PRIVATE c_std_11)
target_compile_definitions(young_studio PRIVATE
    WIN32_LEAN_AND_MEAN
    _CRT_SECURE_NO_WARNINGS
    COBJMACROS
)
target_link_libraries(young_studio PRIVATE
    winhttp
    comctl32
    comdlg32
    ole32
    sapi
)
# Require Windows Vista+ for common controls v6 (visual styles)
target_link_options(young_studio PRIVATE
    /MANIFEST:EMBED
)
configure_file(
    "${CMAKE_CURRENT_SOURCE_DIR}/young_studio.manifest.in"
    "${CMAKE_CURRENT_BINARY_DIR}/young_studio.manifest"
    @ONLY
)


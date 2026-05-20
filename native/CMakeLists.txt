cmake_minimum_required(VERSION 3.20)
project(young_native_claude C)

add_executable(young_haiku_cli
    main.c
    claude_client_winhttp.c
)

target_compile_features(young_haiku_cli PRIVATE c_std_11)

target_link_libraries(young_haiku_cli PRIVATE winhttp)

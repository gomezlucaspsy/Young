#ifndef YOUNG_CLAUDE_CLIENT_H
#define YOUNG_CLAUDE_CLIENT_H

#include <stddef.h>

typedef struct ClaudeOptions {
    const char* model;
    int max_tokens;
    double temperature;
    const char* system_prompt;
} ClaudeOptions;

int claude_message(
    const char* api_key,
    const char* user_prompt,
    const ClaudeOptions* options,
    char* out_text,
    size_t out_text_size,
    char* out_error,
    size_t out_error_size
);

#endif

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

/* Read-only GET against the public GitHub REST API (api.github.com).
   url_path is the request path + query, e.g. "/repos/owner/repo" or
   "/repos/owner/repo/git/trees/main?recursive=1". Set GITHUB_TOKEN in the
   environment to raise the unauthenticated 60 req/hr rate limit or reach
   private repos. Returns 0 on success with the raw JSON body in out_text. */
int github_get(
    const char* url_path,
    char* out_text,
    size_t out_text_size,
    char* out_error,
    size_t out_error_size
);

#endif

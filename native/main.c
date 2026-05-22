#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "claude_client.h"

static const char* configured_model(void) {
    const char* env_model = getenv("YOUNG_CLAUDE_MODEL");
    if (env_model && env_model[0] != '\0') {
        return env_model;
    }
    return NULL;
}

static int is_model_not_found_error(const char* error_text) {
    return error_text && strstr(error_text, "not_found_error") && strstr(error_text, "model");
}

static int configured_max_tokens(void) {
    const char* env_tokens = getenv("YOUNG_MAX_TOKENS");
    if (!env_tokens || env_tokens[0] == '\0') {
        return 192;
    }

    char* end = NULL;
    long parsed = strtol(env_tokens, &end, 10);
    if (end == env_tokens || *end != '\0') {
        return 192;
    }

    if (parsed < 64) parsed = 64;
    if (parsed > 512) parsed = 512;
    return (int)parsed;
}

static double configured_temperature(void) {
    const char* env_temp = getenv("YOUNG_TEMPERATURE");
    if (!env_temp || env_temp[0] == '\0') {
        return 0.2;
    }

    char* end = NULL;
    double parsed = strtod(env_temp, &end);
    if (end == env_temp || *end != '\0') {
        return 0.2;
    }

    if (parsed < 0.0) parsed = 0.0;
    if (parsed > 1.0) parsed = 1.0;
    return parsed;
}

static const char* configured_system_prompt(void) {
    const char* env_prompt = getenv("YOUNG_SYSTEM_PROMPT");
    if (env_prompt && env_prompt[0] != '\0') {
        return env_prompt;
    }
    return "You are Young Oracle. Keep responses concise but complete, and provide runnable practical code when asked.";
}

int main(int argc, char** argv) {
    const char* api_key = getenv("ANTHROPIC_API_KEY");
    if (!api_key || api_key[0] == '\0') {
        fprintf(stderr, "Missing ANTHROPIC_API_KEY environment variable.\n");
        return 2;
    }

    if (argc < 2) {
        fprintf(stderr, "Usage: young_haiku_cli \"your prompt\"\n");
        return 2;
    }

    static const char* fallback_models[] = {
        "claude-haiku-4-5",
        "claude-sonnet-4-20250514",
        "claude-3-5-haiku-20241022",
        "claude-3-haiku-20240307"
    };

    ClaudeOptions options;
    options.model = NULL;
    options.max_tokens = configured_max_tokens();
    options.temperature = configured_temperature();
    options.system_prompt = configured_system_prompt();

    char output[8192];
    char error[4096];

    int rc = 1;
    const char* env_model = configured_model();

    if (env_model) {
        options.model = env_model;
        rc = claude_message(
            api_key,
            argv[1],
            &options,
            output,
            sizeof(output),
            error,
            sizeof(error)
        );
    } else {
        size_t model_count = sizeof(fallback_models) / sizeof(fallback_models[0]);
        for (size_t i = 0; i < model_count; i++) {
            options.model = fallback_models[i];
            rc = claude_message(
                api_key,
                argv[1],
                &options,
                output,
                sizeof(output),
                error,
                sizeof(error)
            );
            if (rc == 0) {
                break;
            }
            if (!is_model_not_found_error(error)) {
                break;
            }
        }
    }

    if (rc != 0) {
        fprintf(stderr, "Claude call failed: %s\n", error);
        if (!env_model && is_model_not_found_error(error)) {
            fprintf(stderr, "Tried defaults: claude-haiku-4-5, claude-sonnet-4-20250514, claude-3-5-haiku-20241022, claude-3-haiku-20240307\n");
            fprintf(stderr, "Tip: set YOUNG_CLAUDE_MODEL to a model available on your Anthropic account.\n");
        }
        return rc;
    }

    puts(output);
    return 0;
}

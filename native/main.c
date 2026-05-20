#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "claude_client.h"

static const char* default_model(void) {
    const char* env_model = getenv("YOUNG_CLAUDE_MODEL");
    if (env_model && env_model[0] != '\0') {
        return env_model;
    }
    return "claude-3-5-haiku-latest";
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

    ClaudeOptions options;
    options.model = default_model();
    options.max_tokens = 96;
    options.temperature = 0.2;
    options.system_prompt = "You are Young Oracle. Keep responses compact and practical.";

    char output[8192];
    char error[4096];

    int rc = claude_message(
        api_key,
        argv[1],
        &options,
        output,
        sizeof(output),
        error,
        sizeof(error)
    );

    if (rc != 0) {
        fprintf(stderr, "Claude call failed: %s\n", error);
        return rc;
    }

    puts(output);
    return 0;
}

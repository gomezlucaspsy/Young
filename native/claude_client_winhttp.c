#define _CRT_SECURE_NO_WARNINGS

#include "claude_client.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <windows.h>
#include <winhttp.h>

#pragma comment(lib, "winhttp.lib")

static void write_err(char* out_error, size_t out_error_size, const char* msg) {
    if (!out_error || out_error_size == 0) {
        return;
    }
    snprintf(out_error, out_error_size, "%s", msg ? msg : "unknown error");
}

static int json_escape(const char* src, char* dst, size_t dst_size) {
    size_t j = 0;
    if (!src || !dst || dst_size == 0) {
        return -1;
    }

    for (size_t i = 0; src[i] != '\0'; i++) {
        unsigned char c = (unsigned char)src[i];
        const char* rep = NULL;
        char hexbuf[7];

        if (c == '\\') rep = "\\\\";
        else if (c == '"') rep = "\\\"";
        else if (c == '\n') rep = "\\n";
        else if (c == '\r') rep = "\\r";
        else if (c == '\t') rep = "\\t";
        else if (c < 0x20) {
            snprintf(hexbuf, sizeof(hexbuf), "\\u%04x", c);
            rep = hexbuf;
        }

        if (rep) {
            size_t n = strlen(rep);
            if (j + n + 1 >= dst_size) return -1;
            memcpy(dst + j, rep, n);
            j += n;
        } else {
            if (j + 2 >= dst_size) return -1;
            dst[j++] = (char)c;
        }
    }

    dst[j] = '\0';
    return 0;
}

static int utf8_to_wide(const char* src, wchar_t* dst, int dst_chars) {
    return MultiByteToWideChar(CP_UTF8, 0, src, -1, dst, dst_chars);
}

static char* find_text_value(char* json) {
    char* p = strstr(json, "\"type\":\"text\"");
    if (!p) {
        p = strstr(json, "\"text\":\"");
    }
    if (!p) {
        return NULL;
    }

    p = strstr(p, "\"text\":\"");
    if (!p) {
        return NULL;
    }

    return p + strlen("\"text\":\"");
}

static int json_unescape_string(const char* src, char* dst, size_t dst_size) {
    size_t j = 0;
    for (size_t i = 0; src[i] != '\0'; i++) {
        char c = src[i];
        if (c == '"') {
            if (i == 0 || src[i - 1] != '\\') {
                break;
            }
        }

        if (c == '\\') {
            char n = src[++i];
            if (n == '\0') break;
            if (j + 2 >= dst_size) return -1;
            if (n == 'n') dst[j++] = '\n';
            else if (n == 'r') dst[j++] = '\r';
            else if (n == 't') dst[j++] = '\t';
            else if (n == '"') dst[j++] = '"';
            else if (n == '\\') dst[j++] = '\\';
            else if (n == 'u') {
                // Keep unicode escapes literal to stay simple and portable.
                if (j + 7 >= dst_size) return -1;
                dst[j++] = '\\';
                dst[j++] = 'u';
                for (int k = 0; k < 4 && src[i + 1] != '\0'; k++) {
                    dst[j++] = src[++i];
                }
            } else {
                dst[j++] = n;
            }
        } else {
            if (j + 2 >= dst_size) return -1;
            dst[j++] = c;
        }
    }

    dst[j] = '\0';
    return 0;
}

int claude_message(
    const char* api_key,
    const char* user_prompt,
    const ClaudeOptions* options,
    char* out_text,
    size_t out_text_size,
    char* out_error,
    size_t out_error_size
) {
    HINTERNET h_session = NULL;
    HINTERNET h_connect = NULL;
    HINTERNET h_request = NULL;
    int rc = 1;

    char escaped_prompt[16384];
    char escaped_system[4096];
    char body[24576];

    const char* model = (options && options->model) ? options->model : "claude-3-5-haiku-latest";
    int max_tokens = (options && options->max_tokens > 0) ? options->max_tokens : 96;
    double temperature = (options) ? options->temperature : 0.2;
    const char* system_prompt = (options && options->system_prompt) ? options->system_prompt : "";

    if (!api_key || api_key[0] == '\0') {
        write_err(out_error, out_error_size, "API key is empty");
        return 2;
    }
    if (!user_prompt || user_prompt[0] == '\0') {
        write_err(out_error, out_error_size, "Prompt is empty");
        return 2;
    }

    if (json_escape(user_prompt, escaped_prompt, sizeof(escaped_prompt)) != 0) {
        write_err(out_error, out_error_size, "Prompt is too large");
        return 2;
    }
    if (json_escape(system_prompt, escaped_system, sizeof(escaped_system)) != 0) {
        write_err(out_error, out_error_size, "System prompt is too large");
        return 2;
    }

    snprintf(
        body,
        sizeof(body),
        "{\"model\":\"%s\",\"max_tokens\":%d,\"temperature\":%.2f,\"system\":\"%s\",\"messages\":[{\"role\":\"user\",\"content\":\"%s\"}]}",
        model,
        max_tokens,
        temperature,
        escaped_system,
        escaped_prompt
    );

    h_session = WinHttpOpen(L"young-native/1.0", WINHTTP_ACCESS_TYPE_DEFAULT_PROXY, WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
    if (!h_session) {
        write_err(out_error, out_error_size, "WinHttpOpen failed");
        goto cleanup;
    }

    h_connect = WinHttpConnect(h_session, L"api.anthropic.com", INTERNET_DEFAULT_HTTPS_PORT, 0);
    if (!h_connect) {
        write_err(out_error, out_error_size, "WinHttpConnect failed");
        goto cleanup;
    }

    h_request = WinHttpOpenRequest(h_connect, L"POST", L"/v1/messages", NULL, WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES, WINHTTP_FLAG_SECURE);
    if (!h_request) {
        write_err(out_error, out_error_size, "WinHttpOpenRequest failed");
        goto cleanup;
    }

    char headers_utf8[4096];
    snprintf(
        headers_utf8,
        sizeof(headers_utf8),
        "content-type: application/json\r\nx-api-key: %s\r\nanthropic-version: 2023-06-01\r\n",
        api_key
    );

    wchar_t headers_wide[4096];
    if (utf8_to_wide(headers_utf8, headers_wide, (int)(sizeof(headers_wide) / sizeof(headers_wide[0]))) <= 0) {
        write_err(out_error, out_error_size, "Header encoding failed");
        goto cleanup;
    }

    if (!WinHttpSendRequest(h_request, headers_wide, (DWORD)-1L, body, (DWORD)strlen(body), (DWORD)strlen(body), 0)) {
        write_err(out_error, out_error_size, "WinHttpSendRequest failed");
        goto cleanup;
    }

    if (!WinHttpReceiveResponse(h_request, NULL)) {
        write_err(out_error, out_error_size, "WinHttpReceiveResponse failed");
        goto cleanup;
    }

    DWORD status = 0;
    DWORD status_size = sizeof(status);
    WinHttpQueryHeaders(h_request, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER, WINHTTP_HEADER_NAME_BY_INDEX, &status, &status_size, WINHTTP_NO_HEADER_INDEX);

    char* response = NULL;
    size_t response_size = 0;

    for (;;) {
        DWORD available = 0;
        if (!WinHttpQueryDataAvailable(h_request, &available)) {
            write_err(out_error, out_error_size, "WinHttpQueryDataAvailable failed");
            free(response);
            goto cleanup;
        }
        if (available == 0) break;

        char* next = (char*)realloc(response, response_size + available + 1);
        if (!next) {
            write_err(out_error, out_error_size, "Out of memory");
            free(response);
            goto cleanup;
        }
        response = next;

        DWORD read_bytes = 0;
        if (!WinHttpReadData(h_request, response + response_size, available, &read_bytes)) {
            write_err(out_error, out_error_size, "WinHttpReadData failed");
            free(response);
            goto cleanup;
        }
        response_size += read_bytes;
        response[response_size] = '\0';
    }

    if (status < 200 || status >= 300) {
        if (response) {
            snprintf(out_error, out_error_size, "HTTP %lu: %s", (unsigned long)status, response);
        } else {
            snprintf(out_error, out_error_size, "HTTP %lu", (unsigned long)status);
        }
        free(response);
        goto cleanup;
    }

    if (!response) {
        write_err(out_error, out_error_size, "Empty response");
        goto cleanup;
    }

    char* text_start = find_text_value(response);
    if (!text_start) {
        write_err(out_error, out_error_size, "Could not parse text output");
        free(response);
        goto cleanup;
    }

    if (json_unescape_string(text_start, out_text, out_text_size) != 0) {
        write_err(out_error, out_error_size, "Output buffer too small");
        free(response);
        goto cleanup;
    }

    free(response);
    rc = 0;

cleanup:
    if (h_request) WinHttpCloseHandle(h_request);
    if (h_connect) WinHttpCloseHandle(h_connect);
    if (h_session) WinHttpCloseHandle(h_session);
    return rc;
}

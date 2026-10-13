/* ===========================================================================
   young_studio.c  —  Young Studio Live   (Native Win32 GUI)
   ===========================================================================
   Links:  winhttp.lib  comctl32.lib  comdlg32.lib  ole32.lib  sapi.lib
   =========================================================================== */

#define WIN32_LEAN_AND_MEAN
#define _CRT_SECURE_NO_WARNINGS
#define COBJMACROS

#include <windows.h>
#include <shellapi.h>
#include <commctrl.h>
#include <commdlg.h>
#include <ole2.h>
#include <sapi.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdarg.h>
#include <ctype.h>

#include "claude_client.h"

#pragma comment(lib, "comctl32.lib")
#pragma comment(lib, "comdlg32.lib")
#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "sapi.lib")
#pragma comment(lib, "shell32.lib")

/* ── Control IDs ─────────────────────────────────────────────────────────── */
/* One consolidated chat-first view (no tabs) — mirrors web/app/live: a
   transcript + MyComputer file panel + input row, and everything else
   (API key, voice toggle) tucked behind one Settings popup. */
enum {
    ID_STATUSBAR = 1000,
    ID_BTN_SETTINGS,

    /* MyComputer file panel */
    ID_LIST_FILES, ID_EDIT_FILE,
    ID_BTN_FILE_NEW, ID_BTN_FILE_SAVE, ID_BTN_FILE_RUN, ID_BTN_FILE_DELETE,

    /* Live chat */
    ID_EDIT_LIVE_OUT, ID_EDIT_LIVE_IN,
    ID_BTN_LIVE_SEND, ID_BTN_LIVE_MIC,

    /* Settings popup */
    ID_EDIT_API_KEY, ID_CHK_VOICE, ID_BTN_SETTINGS_CLOSE,

    /* Reused by the small "new file name" prompt popup */
    ID_PROMPT_EDIT
};

/* ── Custom messages ─────────────────────────────────────────────────────── */
#define WM_LIVE_APPEND    (WM_APP + 1)
#define WM_STATUS_MSG     (WM_APP + 2)
#define WM_MIC_RESULT     (WM_APP + 3)
#define WM_BUSY_CHANGE    (WM_APP + 4)

/* ── Dimensions ──────────────────────────────────────────────────────────── */
#define HDR_H      54
#define PAD        10
#define BTNW       92
#define BTNH       30
#define INROW_H    46
#define FILELIST_H 130
#define MC_PANEL_W 320

/* ── Limits ──────────────────────────────────────────────────────────────── */
#define MAX_PBUF   1024   /* path buffer */
#define MAX_KBUF    512   /* api key buffer */
#define MAX_RBUF  12288   /* response buffer */
#define MAX_HIST     24   /* live history turns */
#define MAX_TREE   4096   /* project tree buffer */

/* ── Brand palette — matches web/app/globals.css so all three Young
   surfaces (native/Python/web) read as one product ──────────────────────── */
#define C_BG        RGB(0x08,0x07,0x0C)   /* --background */
#define C_BG2       RGB(0x12,0x10,0x1A)   /* panel bg, one step lighter */
#define C_TEXT      RGB(0xE8,0xE3,0xF0)   /* --foreground */
#define C_HINT      RGB(0x8B,0x87,0x99)   /* muted label text */
#define C_GOLD      RGB(0xC9,0xA2,0x4B)   /* --gold, wordmark + highlights */
#define C_VIOLET    RGB(0x7C,0x5C,0xFF)   /* --violet, oracle replies */
#define C_GREEN     RGB(0x34,0xD3,0x99)   /* success / online */
#define C_RED       RGB(0xF8,0x71,0x71)   /* error */
#define C_EDIT_BG   RGB(0x0D,0x0B,0x14)
#define C_OUT_LIVE  RGB(0x0B,0x09,0x12)

/* ── Global handles ──────────────────────────────────────────────────────── */
static HWND g_hwnd;

/* MyComputer file panel */
static HWND g_list_files, g_edit_file;
static char g_selected_file[256] = "";

/* Live chat */
static HWND g_edit_live_out, g_edit_live_in;

/* Settings popup — created once at startup, only ever shown/hidden so its
   controls (API key, voice toggle) stay valid for the app's lifetime. */
static HWND g_settings_hwnd;
static HWND g_edit_api_key, g_chk_voice;

/* Brushes */
static HBRUSH g_br_bg, g_br_bg2, g_br_edit, g_br_live;

/* Fonts */
static HFONT g_fui, g_fmono, g_fbold, g_ftitle;

/* App state */
static char  g_root[MAX_PBUF];
static BOOL  g_live_busy = FALSE;

/* Live history */
typedef struct { char role[12]; char text[2048]; } LHEntry;
static LHEntry g_lh[MAX_HIST];
static int     g_lhc = 0;

/* ═══════════════════════════════════════════════════════════════════════════
   §1  STRING UTILITIES
   ═══════════════════════════════════════════════════════════════════════════ */

static void str_append(char *dst, size_t cap, const char *src) {
    size_t dlen = strlen(dst);
    size_t slen = strlen(src);
    if (dlen + slen + 1 > cap) slen = cap - dlen - 1;
    if (slen == 0) return;
    memcpy(dst + dlen, src, slen);
    dst[dlen + slen] = '\0';
}

static void str_appendf(char *dst, size_t cap, const char *fmt, ...) {
    char tmp[2048];
    va_list va;
    va_start(va, fmt);
    vsnprintf(tmp, sizeof(tmp), fmt, va);
    va_end(va);
    str_append(dst, cap, tmp);
}

/* ── UTF-8 <-> UTF-16 boundary helpers ────────────────────────────────────
   Claude's API, the FILE_ACTION/PC_ACTION text, and .young files on disk are
   all UTF-8. Win32 edit controls store text as UTF-16 regardless of which
   A/W function created them, and only the "A" *messages* round-trip through
   the ANSI codepage (mangling anything outside it, including all emoji and
   some accents). So: convert at the boundary and always use the W message
   for controls that may carry Claude/file text, instead of the A one. */
static wchar_t *utf8_to_wide_alloc(const char *utf8) {
    if (!utf8) utf8 = "";
    int wlen = MultiByteToWideChar(CP_UTF8, 0, utf8, -1, NULL, 0);
    if (wlen <= 0) wlen = 1;
    wchar_t *w = (wchar_t *)malloc((size_t)wlen * sizeof(wchar_t));
    if (w) MultiByteToWideChar(CP_UTF8, 0, utf8, -1, w, wlen);
    return w;
}

/* Read an edit control's text out as UTF-8 (for sending to Claude or saving
   a .young file), instead of GetWindowTextA's lossy ANSI round-trip. */
static void get_text_utf8(HWND hw, char *out, int out_cap) {
    int wlen = GetWindowTextLengthW(hw) + 1;
    wchar_t *wbuf = (wchar_t *)malloc((size_t)wlen * sizeof(wchar_t));
    if (!wbuf) { out[0] = '\0'; return; }
    GetWindowTextW(hw, wbuf, wlen);
    int n = WideCharToMultiByte(CP_UTF8, 0, wbuf, -1, out, out_cap, NULL, NULL);
    if (n <= 0) out[0] = '\0';
    free(wbuf);
}

/* ── Append text to a multiline edit control ─────────────────────────────── */
/* A multiline EDIT only breaks lines on "\r\n"; a bare "\n" (Python output,
   Claude replies) would glue a whole multi-line error report into one long
   line that runs off-screen. Normalize every lone '\n' to "\r\n". */
static void edit_append(HWND hw, const char *text) {
    wchar_t *wtext = utf8_to_wide_alloc(text);
    if (!wtext) return;
    size_t n = wcslen(wtext), extra = 0;
    for (size_t i = 0; i < n; i++)
        if (wtext[i] == L'\n' && (i == 0 || wtext[i - 1] != L'\r')) extra++;
    wchar_t *crlf = wtext;
    if (extra) {
        crlf = (wchar_t *)malloc((n + extra + 1) * sizeof(wchar_t));
        if (!crlf) { free(wtext); return; }
        size_t j = 0;
        for (size_t i = 0; i < n; i++) {
            if (wtext[i] == L'\n' && (i == 0 || wtext[i - 1] != L'\r')) crlf[j++] = L'\r';
            crlf[j++] = wtext[i];
        }
        crlf[j] = L'\0';
    }
    int len = GetWindowTextLengthW(hw);
    SendMessageW(hw, EM_SETSEL, (WPARAM)len, (LPARAM)len);
    SendMessageW(hw, EM_REPLACESEL, FALSE, (LPARAM)crlf);
    SendMessage(hw, WM_VSCROLL, SB_BOTTOM, 0);
    if (crlf != wtext) free(crlf);
    free(wtext);
}

static void edit_clear(HWND hw) {
    SetWindowTextW(hw, L"");
}

static void edit_set(HWND hw, const char *text) {
    wchar_t *wtext = utf8_to_wide_alloc(text);
    if (wtext) { SetWindowTextW(hw, wtext); free(wtext); }
    SendMessage(hw, EM_SETSEL, 0, -1);
    SendMessage(hw, EM_SETSEL, -1, -1);
    SendMessage(hw, WM_VSCROLL, SB_BOTTOM, 0);
}

/* ── Status text (header label, id 9003 — see create_all_controls) ──────── */
static void set_status(const char *fmt, ...) {
    char buf[512];
    va_list va;
    va_start(va, fmt);
    vsnprintf(buf, sizeof(buf), fmt, va);
    va_end(va);
    wchar_t *wbuf = utf8_to_wide_alloc(buf);
    if (wbuf) { SetWindowTextW(GetDlgItem(g_hwnd, 9003), wbuf); free(wbuf); }
}

/* ── Get API key from edit (trim whitespace) ─────────────────────────────── */
static void get_api_key(char *out, int cap) {
    GetWindowTextA(g_edit_api_key, out, cap);
    /* trim leading/trailing spaces */
    char *p = out;
    while (*p == ' ' || *p == '\t') p++;
    if (p != out) memmove(out, p, strlen(p) + 1);
    int n = (int)strlen(out);
    while (n > 0 && (out[n-1] == ' ' || out[n-1] == '\t' || out[n-1] == '\n' || out[n-1] == '\r'))
        out[--n] = '\0';
}

/* ═══════════════════════════════════════════════════════════════════════════
   §2  HIDDEN PROCESS EXECUTION  (no console window)
   ═══════════════════════════════════════════════════════════════════════════ */

/* Run cmd, capture stdout+stderr into out_buf (up to out_cap bytes).
   When the output is longer than out_cap, the START is dropped and the end
   kept: the runner prints its error report last, and that is the part the
   user and the Oracle need. The process is killed after timeout_ms
   (<= 0: no limit). Returns exit code, -1 on launch failure, -2 on timeout. */
static int run_hidden(const char *cmd, char *out_buf, int out_cap, int timeout_ms) {
    if (out_buf && out_cap > 0) out_buf[0] = '\0';

    SECURITY_ATTRIBUTES sa = { sizeof(sa), NULL, TRUE };
    HANDLE hRead = NULL, hWrite = NULL;
    if (!CreatePipe(&hRead, &hWrite, &sa, 0)) return -1;
    SetHandleInformation(hRead, HANDLE_FLAG_INHERIT, 0);

    STARTUPINFOA si = { sizeof(si) };
    si.dwFlags    = STARTF_USESHOWWINDOW | STARTF_USESTDHANDLES;
    si.wShowWindow = SW_HIDE;
    si.hStdOutput = hWrite;
    si.hStdError  = hWrite;

    PROCESS_INFORMATION pi = {0};
    /* need mutable copy for CreateProcess */
    char *cmdcopy = _strdup(cmd);
    BOOL ok = CreateProcessA(NULL, cmdcopy, NULL, NULL, TRUE,
                             CREATE_NO_WINDOW, NULL, NULL, &si, &pi);
    free(cmdcopy);
    CloseHandle(hWrite);

    if (!ok) { CloseHandle(hRead); return -1; }

    /* Poll instead of a blocking ReadFile, so a script that never exits can't
       hang this thread past timeout_ms. */
    static const char TRIM_MARK[] = "...(output trimmed)...\n";
    int keep = (out_buf && out_cap > (int)sizeof(TRIM_MARK) + 1) ? out_cap - 1 - (int)(sizeof(TRIM_MARK) - 1) : 0;
    char *tail = keep > 0 ? (char *)malloc((size_t)keep) : NULL;
    int total = 0, trimmed = 0, timed_out = 0;
    ULONGLONG deadline = timeout_ms > 0 ? GetTickCount64() + (ULONGLONG)timeout_ms : 0;
    for (;;) {
        DWORD avail = 0;
        BOOL pipe_ok = PeekNamedPipe(hRead, NULL, 0, NULL, &avail, NULL);
        if (pipe_ok && avail > 0) {
            char tmp[4096];
            DWORD nread = 0;
            if (!ReadFile(hRead, tmp, avail < sizeof(tmp) ? avail : (DWORD)sizeof(tmp), &nread, NULL) || nread == 0)
                break;
            if (tail) {
                if ((int)nread >= keep) {          /* chunk alone fills the buffer */
                    memcpy(tail, tmp + nread - keep, (size_t)keep);
                    trimmed |= total > 0 || (int)nread > keep;
                    total = keep;
                } else if (total + (int)nread > keep) { /* slide: drop the oldest bytes */
                    int drop = total + (int)nread - keep;
                    memmove(tail, tail + drop, (size_t)(total - drop));
                    memcpy(tail + total - drop, tmp, nread);
                    total = keep;
                    trimmed = 1;
                } else {
                    memcpy(tail + total, tmp, nread);
                    total += nread;
                }
            }
            continue;
        }
        if (!pipe_ok) break;                         /* writer closed: process done */
        if (WaitForSingleObject(pi.hProcess, 0) == WAIT_OBJECT_0) {
            if (!PeekNamedPipe(hRead, NULL, 0, NULL, &avail, NULL) || avail == 0) break;
            continue;                                /* drain what's left */
        }
        if (deadline && GetTickCount64() > deadline) {
            TerminateProcess(pi.hProcess, 1);
            timed_out = 1;
            break;
        }
        Sleep(15);
    }

    if (out_buf && out_cap > 0) {
        int pos = 0;
        if (trimmed) { memcpy(out_buf, TRIM_MARK, sizeof(TRIM_MARK) - 1); pos = (int)sizeof(TRIM_MARK) - 1; }
        if (tail && total > 0) { memcpy(out_buf + pos, tail, (size_t)total); pos += total; }
        out_buf[pos] = '\0';
        if (timed_out)
            str_appendf(out_buf, (size_t)out_cap, "\nERROR: stopped after %d s (infinite loop?)", timeout_ms / 1000);
    }
    free(tail);

    CloseHandle(hRead);
    WaitForSingleObject(pi.hProcess, 2000);
    DWORD exit_code = 0;
    GetExitCodeProcess(pi.hProcess, &exit_code);
    CloseHandle(pi.hProcess);
    CloseHandle(pi.hThread);
    return timed_out ? -2 : (int)exit_code;
}

/* ── Run hidden with no output capture ───────────────────────────────────── */
static void run_hidden_detach(const char *cmd) {
    STARTUPINFOA si = { sizeof(si) };
    si.dwFlags     = STARTF_USESHOWWINDOW;
    si.wShowWindow = SW_HIDE;
    PROCESS_INFORMATION pi = {0};
    char *copy = _strdup(cmd);
    CreateProcessA(NULL, copy, NULL, NULL, FALSE, CREATE_NO_WINDOW, NULL, NULL, &si, &pi);
    free(copy);
    if (pi.hProcess) CloseHandle(pi.hProcess);
    if (pi.hThread)  CloseHandle(pi.hThread);
}

/* ── Find Python in venv or system ───────────────────────────────────────── */
static void find_python(char *out, int cap) {
    char candidate[MAX_PBUF];
    snprintf(candidate, sizeof(candidate), "%s\\.venv\\Scripts\\python.exe", g_root);
    if (GetFileAttributesA(candidate) != INVALID_FILE_ATTRIBUTES) {
        snprintf(out, cap, "\"%s\"", candidate);
        return;
    }
    /* fall back to system python */
    snprintf(out, cap, "python");
}

/* ═══════════════════════════════════════════════════════════════════════════
   §3  VOICE  (SAPI ISpVoice COM  +  hidden PS for mic)
   ═══════════════════════════════════════════════════════════════════════════ */

/* TTS – runs on background thread; g_hwnd is valid for the duration */
static DWORD WINAPI tts_thread(LPVOID param) {
    char *text = (char *)param;   /* caller heap-allocated, we free */
    CoInitialize(NULL);

    ISpVoice *pv = NULL;
    HRESULT hr = CoCreateInstance(&CLSID_SpVoice, NULL, CLSCTX_ALL,
                                  &IID_ISpVoice, (void **)&pv);
    if (SUCCEEDED(hr) && pv) {
        wchar_t wbuf[2048];
        MultiByteToWideChar(CP_UTF8, 0, text, -1, wbuf, 2048);
        ISpVoice_Speak(pv, wbuf, SPF_DEFAULT, NULL);
        ISpVoice_Release(pv);
    }

    CoUninitialize();
    free(text);
    return 0;
}

static void speak_async(const char *text) {
    /* cap to 600 chars to keep it brief */
    char *copy = _strdup(text);
    if (!copy) return;
    if (strlen(copy) > 600) copy[600] = '\0';
    HANDLE ht = CreateThread(NULL, 0, tts_thread, copy, 0, NULL);
    if (ht) CloseHandle(ht);
}

/* Mic thread – runs PowerShell SAPI recognition hidden, posts result */
typedef struct { HWND hwnd; } MicParam;

static DWORD WINAPI mic_thread(LPVOID param) {
    MicParam *mp = (MicParam *)param;
    HWND hwnd = mp->hwnd;
    free(mp);

    const char *ps_script =
        "Add-Type -AssemblyName System.Speech; "
        "$r = New-Object System.Speech.Recognition.SpeechRecognitionEngine; "
        "$r.SetInputToDefaultAudioDevice(); "
        "$r.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar)); "
        "$res = $r.Recognize([TimeSpan]::FromSeconds(8)); "
        "if ($res) { Write-Output $res.Text } else { Write-Output '' }";

    char cmd[2048];
    snprintf(cmd, sizeof(cmd),
             "powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -Command \"%s\"",
             ps_script);

    char out[1024] = "";
    run_hidden(cmd, out, sizeof(out), 12000);

    /* strip trailing newlines */
    int n = (int)strlen(out);
    while (n > 0 && (out[n-1] == '\r' || out[n-1] == '\n' || out[n-1] == ' '))
        out[--n] = '\0';

    if (n > 0) {
        char *copy = _strdup(out);
        PostMessage(hwnd, WM_MIC_RESULT, 0, (LPARAM)copy);
    } else {
        PostMessage(hwnd, WM_MIC_RESULT, 0, (LPARAM)NULL);
    }
    return 0;
}

static void mic_capture_async(HWND hwnd) {
    MicParam *mp = (MicParam *)malloc(sizeof(MicParam));
    if (!mp) return;
    mp->hwnd = hwnd;
    HANDLE ht = CreateThread(NULL, 0, mic_thread, mp, 0, NULL);
    if (ht) CloseHandle(ht);
}

/* ═══════════════════════════════════════════════════════════════════════════
   §4  MYCOMPUTER  (sandboxed .young file ops)
   ═══════════════════════════════════════════════════════════════════════════ */

/* Ensure path is inside g_root and ends in .young */
static int safe_young_path(const char *relpath, char *out, int cap) {
    if (!relpath || !relpath[0]) return 0;
    /* reject traversal */
    if (strstr(relpath, "..")) return 0;
    const char *p = relpath;
    while (*p == '/' || *p == '\\') p++;
    /* must end in .young */
    size_t n = strlen(p);
    if (n < 7) return 0;
    if (_stricmp(p + n - 6, ".young") != 0) return 0;
    snprintf(out, cap, "%s\\%s", g_root, p);
    /* normalise slashes */
    for (char *c = out; *c; c++) if (*c == '/') *c = '\\';
    return 1;
}

static void mc_create(const char *relpath, const char *content, char *result, int rcap) {
    char full[MAX_PBUF];
    if (!safe_young_path(relpath, full, sizeof(full))) {
        snprintf(result, rcap, "ERROR: invalid path");
        return;
    }
    if (GetFileAttributesA(full) != INVALID_FILE_ATTRIBUTES) {
        snprintf(result, rcap, "ERROR: file already exists");
        return;
    }
    FILE *f = fopen(full, "w");
    if (!f) { snprintf(result, rcap, "ERROR: cannot create file"); return; }
    fputs(content ? content : "", f);
    fclose(f);
    snprintf(result, rcap, "OK: created %s", relpath);
}

static void mc_read(const char *relpath, char *result, int rcap) {
    char full[MAX_PBUF];
    if (!safe_young_path(relpath, full, sizeof(full))) {
        snprintf(result, rcap, "ERROR: invalid path");
        return;
    }
    FILE *f = fopen(full, "r");
    if (!f) { snprintf(result, rcap, "ERROR: file not found"); return; }
    int n = (int)fread(result, 1, rcap - 1, f);
    fclose(f);
    result[n > 0 ? n : 0] = '\0';
}

static void mc_update(const char *relpath, const char *content, char *result, int rcap) {
    char full[MAX_PBUF];
    if (!safe_young_path(relpath, full, sizeof(full))) {
        snprintf(result, rcap, "ERROR: invalid path");
        return;
    }
    FILE *f = fopen(full, "w");
    if (!f) { snprintf(result, rcap, "ERROR: cannot write"); return; }
    fputs(content ? content : "", f);
    fclose(f);
    snprintf(result, rcap, "OK: updated %s", relpath);
}

/* UI-only (the "Delete" button in the file panel) — not part of the
   FILE_ACTION protocol the model can invoke, that stays create|read|update|list. */
static void mc_delete(const char *relpath, char *result, int rcap) {
    char full[MAX_PBUF];
    if (!safe_young_path(relpath, full, sizeof(full))) {
        snprintf(result, rcap, "ERROR: invalid path");
        return;
    }
    if (DeleteFileA(full)) snprintf(result, rcap, "OK: deleted %s", relpath);
    else snprintf(result, rcap, "ERROR: cannot delete %s", relpath);
}

static void mc_list(char *result, int rcap) {
    result[0] = '\0';
    char pattern[MAX_PBUF];
    snprintf(pattern, sizeof(pattern), "%s\\*.young", g_root);
    WIN32_FIND_DATAA fd;
    HANDLE h = FindFirstFileA(pattern, &fd);
    if (h == INVALID_HANDLE_VALUE) { snprintf(result, rcap, "(none)"); return; }
    do {
        str_append(result, rcap, fd.cFileName);
        str_append(result, rcap, "\n");
    } while (FindNextFileA(h, &fd));
    FindClose(h);
    if (!result[0]) snprintf(result, rcap, "(none)");
}

/* ── Build project tree string ───────────────────────────────────────────── */
static void build_tree(char *out, int cap) {
    out[0] = '\0';
    mc_list(out, cap);
}

/* ═══════════════════════════════════════════════════════════════════════════
   §5  FILE_ACTION PARSER
   ═══════════════════════════════════════════════════════════════════════════ */

typedef struct {
    char action[32];
    char path[256];
    char name[256];
    char type[32];
    char content[8192];
} FileAction;

/* Parse [FILE_ACTION:action|path|name|type|content] blocks.
   Returns count of actions found (up to max_actions).            */
static int parse_file_actions(const char *text, FileAction *actions, int max_actions) {
    int count = 0;
    const char *p = text;
    while (count < max_actions) {
        const char *start = strstr(p, "[FILE_ACTION:");
        if (!start) break;
        const char *end = strchr(start, ']');
        if (!end) break;

        /* extract inner content */
        const char *inner = start + 13;  /* skip "[FILE_ACTION:" */
        size_t inner_len = (size_t)(end - inner);
        char buf[8512];
        if (inner_len >= sizeof(buf)) { p = end + 1; continue; }
        memcpy(buf, inner, inner_len);
        buf[inner_len] = '\0';

        /* split by '|' up to 5 fields */
        char *fields[5] = {0};
        int fi = 0;
        char *tok = buf;
        for (int i = 0; i < (int)(inner_len + 1) && fi < 5; i++) {
            if (buf[i] == '|' || buf[i] == '\0') {
                fields[fi++] = tok;
                buf[i] = '\0';
                tok = buf + i + 1;
            }
        }

        FileAction *fa = &actions[count];
        memset(fa, 0, sizeof(*fa));
        if (fi > 0 && fields[0]) snprintf(fa->action,  sizeof(fa->action),  "%s", fields[0]);
        if (fi > 1 && fields[1]) snprintf(fa->path,    sizeof(fa->path),    "%s", fields[1]);
        if (fi > 2 && fields[2]) snprintf(fa->name,    sizeof(fa->name),    "%s", fields[2]);
        if (fi > 3 && fields[3]) snprintf(fa->type,    sizeof(fa->type),    "%s", fields[3]);
        if (fi > 4 && fields[4]) snprintf(fa->content, sizeof(fa->content), "%s", fields[4]);
        count++;
        p = end + 1;
    }
    return count;
}

/* Remove FILE_ACTION blocks from text for display */
static void strip_file_actions(const char *src, char *dst, int cap) {
    dst[0] = '\0';
    int di = 0;
    const char *p = src;
    while (*p && di < cap - 1) {
        const char *fa = strstr(p, "[FILE_ACTION:");
        if (!fa) {
            /* copy rest */
            while (*p && di < cap - 1) dst[di++] = *p++;
            break;
        }
        /* copy up to fa */
        while (p < fa && di < cap - 1) dst[di++] = *p++;
        const char *end = strchr(fa, ']');
        p = end ? end + 1 : fa + 1;
    }
    dst[di] = '\0';
}

/* ═══════════════════════════════════════════════════════════════════════════
   §5b  FALLBACK FILE-ACTION DETECTION
   ═══════════════════════════════════════════════════════════════════════════
   Claude Haiku occasionally narrates a create/save without emitting the
   FILE_ACTION tag. If a reply names a bare "*.young" file AND contains a
   fenced code block but produced zero parsed actions, synthesize a single
   "create" action from those two pieces instead of silently losing the work. */

static int find_young_filename(const char *text, char *out, int cap) {
    const char *p = text;
    while (*p) {
        const char *dot = strstr(p, ".young");
        if (!dot) return 0;
        const char *start = dot;
        while (start > text &&
               (isalnum((unsigned char)start[-1]) || start[-1] == '_' || start[-1] == '-'))
            start--;
        size_t len = (size_t)(dot + 6 - start);
        if (len > 6 && len < (size_t)cap) {
            memcpy(out, start, len);
            out[len] = '\0';
            return 1;
        }
        p = dot + 6;
    }
    return 0;
}

static int find_code_fence(const char *text, char *out, int cap) {
    const char *start = strstr(text, "```");
    if (!start) return 0;
    start += 3;
    const char *nl = strchr(start, '\n');
    const char *body = nl ? nl + 1 : start;
    const char *end = strstr(body, "```");
    if (!end || end <= body) return 0;
    size_t len = (size_t)(end - body);
    if (len == 0 || len >= (size_t)cap) return 0;
    memcpy(out, body, len);
    out[len] = '\0';
    int n = (int)strlen(out);
    while (n > 0 && (out[n-1] == '\n' || out[n-1] == '\r' || out[n-1] == ' '))
        out[--n] = '\0';
    return n > 0;
}

/* Returns 1 and fills *out if a fallback create action was detected. */
static int try_fallback_file_action(const char *visible_text, FileAction *out) {
    char filename[256];
    if (!find_young_filename(visible_text, filename, sizeof(filename))) return 0;
    char content[8192];
    if (!find_code_fence(visible_text, content, sizeof(content))) return 0;

    memset(out, 0, sizeof(*out));
    snprintf(out->action, sizeof(out->action), "create");
    snprintf(out->path,   sizeof(out->path),   "/");
    snprintf(out->name,   sizeof(out->name),   "%s", filename);
    snprintf(out->type,   sizeof(out->type),   "file");
    snprintf(out->content, sizeof(out->content), "%s", content);
    return 1;
}

/* ═══════════════════════════════════════════════════════════════════════════
   §5c  PC_ACTION  (real-computer status/ops — small fixed allowlist)
   ═══════════════════════════════════════════════════════════════════════════
   Unlike FILE_ACTION (sandboxed to *.young files under g_root), these reach
   the real machine. There is deliberately NO generic "run shell command"
   action — only four enumerated, mostly read-only operations — so the model
   can check on / act within known-safe bounds instead of executing arbitrary
   strings it composes itself. Every PC_ACTION is echoed to the Live
   transcript as it runs, so nothing happens invisibly. */

typedef struct {
    char type[32];
    char param[384];
} PcAction;

/* Parse [PC_ACTION:type|param] blocks. */
static int parse_pc_actions(const char *text, PcAction *actions, int max_actions) {
    int count = 0;
    const char *p = text;
    while (count < max_actions) {
        const char *start = strstr(p, "[PC_ACTION:");
        if (!start) break;
        const char *end = strchr(start, ']');
        if (!end) break;

        const char *inner = start + 11;  /* skip "[PC_ACTION:" */
        size_t inner_len = (size_t)(end - inner);
        char buf[544];
        if (inner_len >= sizeof(buf)) { p = end + 1; continue; }
        memcpy(buf, inner, inner_len);
        buf[inner_len] = '\0';

        PcAction *pa = &actions[count];
        memset(pa, 0, sizeof(*pa));
        char *bar = strchr(buf, '|');
        if (bar) {
            *bar = '\0';
            snprintf(pa->type,  sizeof(pa->type),  "%s", buf);
            snprintf(pa->param, sizeof(pa->param), "%s", bar + 1);
        } else {
            snprintf(pa->type, sizeof(pa->type), "%s", buf);
        }
        count++;
        p = end + 1;
    }
    return count;
}

static void strip_pc_actions(const char *src, char *dst, int cap) {
    dst[0] = '\0';
    int di = 0;
    const char *p = src;
    while (*p && di < cap - 1) {
        const char *pa = strstr(p, "[PC_ACTION:");
        if (!pa) {
            while (*p && di < cap - 1) dst[di++] = *p++;
            break;
        }
        while (p < pa && di < cap - 1) dst[di++] = *p++;
        const char *end = strchr(pa, ']');
        p = end ? end + 1 : pa + 1;
    }
    dst[di] = '\0';
}

/* status: no param — OS/disk/RAM summary, mirrors "check on their computer's status" */
static void pc_status(char *result, int rcap) {
    char drive[4] = "C:\\";
    if (g_root[0] && g_root[1] == ':') drive[0] = g_root[0];

    ULARGE_INTEGER free_bytes = {0}, total_bytes = {0};
    double free_gb = 0.0, total_gb = 0.0;
    if (GetDiskFreeSpaceExA(drive, &free_bytes, &total_bytes, NULL)) {
        free_gb  = (double)free_bytes.QuadPart  / (1024.0 * 1024.0 * 1024.0);
        total_gb = (double)total_bytes.QuadPart / (1024.0 * 1024.0 * 1024.0);
    }

    MEMORYSTATUSEX ms = { sizeof(ms) };
    GlobalMemoryStatusEx(&ms);

    snprintf(result, rcap,
             "Drive %s: %.1f GB free of %.1f GB | RAM in use: %lu%% | Project root: %s",
             drive, free_gb, total_gb, ms.dwMemoryLoad, g_root);
}

/* list_processes: no param — read-only Tasklist snapshot */
static void pc_list_processes(char *result, int rcap) {
    run_hidden("tasklist", result, rcap, 5000);
    if ((int)strlen(result) > 1800) result[1800] = '\0';
    if (!result[0]) snprintf(result, rcap, "(no output)");
}

/* open_folder: no param — opens the project root in Explorer (visible, benign) */
static void pc_open_folder(char *result, int rcap) {
    HINSTANCE h = ShellExecuteA(NULL, "open", g_root, NULL, NULL, SW_SHOWNORMAL);
    if ((intptr_t)h > 32) snprintf(result, rcap, "OK: opened %s in Explorer", g_root);
    else snprintf(result, rcap, "ERROR: could not open folder");
}

/* run_young|filename.young — executes an existing project script, sandboxed
   the same way FILE_ACTION is (safe_young_path rejects traversal / non-.young). */
static void pc_run_young(const char *filename, char *result, int rcap) {
    char full[MAX_PBUF];
    if (!safe_young_path(filename, full, sizeof(full))) {
        snprintf(result, rcap, "ERROR: invalid .young path");
        return;
    }
    if (GetFileAttributesA(full) == INVALID_FILE_ATTRIBUTES) {
        snprintf(result, rcap, "ERROR: file not found: %s", filename);
        return;
    }
    char python[MAX_PBUF];
    find_python(python, sizeof(python));
    char runner[MAX_PBUF];
    snprintf(runner, sizeof(runner), "%s\\young_runner.py", g_root);
    char cmd[MAX_PBUF * 3];
    snprintf(cmd, sizeof(cmd), "%s \"%s\" --timeout 10 \"%s\"", python, runner, full);
    /* Prefix with OK/ERROR like the Python surfaces do, so the Oracle knows to
       fix the file; run_hidden keeps the tail, where the error report is. */
    int body_cap = rcap - 48;
    char *body = body_cap > 0 ? (char *)malloc((size_t)body_cap) : NULL;
    if (!body) { snprintf(result, rcap, "ERROR: out of memory"); return; }
    int code = run_hidden(cmd, body, body_cap, 15000);
    snprintf(result, rcap, "%s (exit %d)\n%s",
             code == 0 ? "OK: ran" : "ERROR: run failed", code, body[0] ? body : "(no output)");
    free(body);
}

/* read_repo|<github url or owner/repo>[@branch][|path/to/file] — reads a
   public GitHub repo's file tree, or one file's content, via the GitHub REST
   API (github_get, in claude_client_winhttp.c). Read-only: nothing here can
   write to GitHub. Set GITHUB_TOKEN in the env for private repos / a higher
   rate limit. */
#define GITHUB_RBUF 65536

static int b64_val(char c) {
    if (c >= 'A' && c <= 'Z') return c - 'A';
    if (c >= 'a' && c <= 'z') return c - 'a' + 26;
    if (c >= '0' && c <= '9') return c - '0' + 52;
    if (c == '+') return 62;
    if (c == '/') return 63;
    return -1;
}

/* GitHub's contents API wraps base64 with a literal "\n" (backslash-n) every
   60 chars for readability; strip those two-char JSON escape sequences
   before decoding so 'n' isn't mistaken for base64 data. */
static void strip_escaped_newlines(char *s) {
    char *src = s, *dst = s;
    while (*src) {
        if (src[0] == '\\' && src[1] == 'n') { src += 2; continue; }
        *dst++ = *src++;
    }
    *dst = '\0';
}

static void base64_decode(const char *src, char *out, int out_cap) {
    int vals[4], nv = 0, oi = 0;
    for (const char *p = src; *p && oi < out_cap - 1; p++) {
        int v = b64_val(*p);
        if (v < 0) continue;  /* skip '=' padding, whitespace, anything stray */
        vals[nv++] = v;
        if (nv == 4) {
            unsigned int n = ((unsigned)vals[0] << 18) | ((unsigned)vals[1] << 12) | ((unsigned)vals[2] << 6) | (unsigned)vals[3];
            if (oi < out_cap - 1) out[oi++] = (char)((n >> 16) & 0xFF);
            if (oi < out_cap - 1) out[oi++] = (char)((n >> 8) & 0xFF);
            if (oi < out_cap - 1) out[oi++] = (char)(n & 0xFF);
            nv = 0;
        }
    }
    if (nv >= 2) {
        unsigned int n = ((unsigned)vals[0] << 18) | ((unsigned)vals[1] << 12) | ((unsigned)(nv > 2 ? vals[2] : 0) << 6);
        if (oi < out_cap - 1) out[oi++] = (char)((n >> 16) & 0xFF);
        if (nv == 3 && oi < out_cap - 1) out[oi++] = (char)((n >> 8) & 0xFF);
    }
    out[oi] = '\0';
}

/* Parse "owner/repo", "owner/repo@branch", or a github.com URL (optionally
   /tree/<branch> or /blob/<branch>/path) into its parts. */
static int parse_repo_ref(const char *raw, char *owner, size_t owner_cap,
                           char *repo, size_t repo_cap,
                           char *branch, size_t branch_cap,
                           char *path, size_t path_cap) {
    owner[0] = repo[0] = branch[0] = path[0] = '\0';
    if (!raw || !raw[0]) return 0;

    const char *p = raw;
    const char *gh = strstr(p, "github.com/");
    if (gh) p = gh + strlen("github.com/");

    char buf[512];
    snprintf(buf, sizeof(buf), "%s", p);
    size_t len = strlen(buf);
    while (len > 0 && buf[len - 1] == '/') buf[--len] = '\0';

    char *seg[8];
    int nseg = 0;
    char *save = NULL;
    char *tok = strtok_s(buf, "/", &save);
    while (tok && nseg < 8) { seg[nseg++] = tok; tok = strtok_s(NULL, "/", &save); }
    if (nseg < 2) return 0;

    snprintf(owner, owner_cap, "%s", seg[0]);

    char repo_buf[256];
    snprintf(repo_buf, sizeof(repo_buf), "%s", seg[1]);
    size_t rl = strlen(repo_buf);
    if (rl > 4 && _stricmp(repo_buf + rl - 4, ".git") == 0) repo_buf[rl - 4] = '\0';

    char *at = strchr(repo_buf, '@');
    if (at) {
        *at = '\0';
        snprintf(branch, branch_cap, "%s", at + 1);
    }
    snprintf(repo, repo_cap, "%s", repo_buf);

    if (nseg >= 4 && (strcmp(seg[2], "tree") == 0 || strcmp(seg[2], "blob") == 0)) {
        snprintf(branch, branch_cap, "%s", seg[3]);
        if (nseg > 4) {
            char joined[400] = "";
            for (int i = 4; i < nseg; i++) {
                if (i > 4) strncat(joined, "/", sizeof(joined) - strlen(joined) - 1);
                strncat(joined, seg[i], sizeof(joined) - strlen(joined) - 1);
            }
            snprintf(path, path_cap, "%s", joined);
        }
    }
    return owner[0] && repo[0];
}

static void pc_read_repo(const char *param, char *result, int rcap) {
    char ref[300] = "";
    char extra_path[220] = "";
    const char *bar = param ? strchr(param, '|') : NULL;
    if (bar) {
        size_t rlen = (size_t)(bar - param);
        if (rlen >= sizeof(ref)) rlen = sizeof(ref) - 1;
        memcpy(ref, param, rlen);
        ref[rlen] = '\0';
        snprintf(extra_path, sizeof(extra_path), "%s", bar + 1);
    } else {
        snprintf(ref, sizeof(ref), "%s", param ? param : "");
    }

    char owner[80], repo[120], branch[80], url_path[220];
    if (!parse_repo_ref(ref, owner, sizeof(owner), repo, sizeof(repo),
                         branch, sizeof(branch), url_path, sizeof(url_path))) {
        snprintf(result, rcap, "ERROR: could not parse GitHub repo reference '%s'", ref);
        return;
    }
    const char *path = extra_path[0] ? extra_path : url_path;

    char *resp = (char *)malloc(GITHUB_RBUF);
    char err[512] = "";
    if (!resp) { snprintf(result, rcap, "ERROR: out of memory"); return; }

    if (!branch[0]) {
        char api_path[300];
        snprintf(api_path, sizeof(api_path), "/repos/%s/%s", owner, repo);
        if (github_get(api_path, resp, GITHUB_RBUF, err, sizeof(err)) != 0) {
            snprintf(result, rcap, "ERROR: repo lookup failed for %s/%s: %s", owner, repo, err);
            free(resp);
            return;
        }
        char *db = strstr(resp, "\"default_branch\":\"");
        if (db) {
            db += strlen("\"default_branch\":\"");
            char *end = strchr(db, '"');
            size_t blen = end ? (size_t)(end - db) : 0;
            if (blen >= sizeof(branch)) blen = sizeof(branch) - 1;
            memcpy(branch, db, blen);
            branch[blen] = '\0';
        } else {
            snprintf(branch, sizeof(branch), "main");
        }
    }

    if (path[0]) {
        char api_path[500];
        snprintf(api_path, sizeof(api_path), "/repos/%s/%s/contents/%s?ref=%s", owner, repo, path, branch);
        if (github_get(api_path, resp, GITHUB_RBUF, err, sizeof(err)) != 0) {
            snprintf(result, rcap, "ERROR: could not read %s/%s/%s@%s: %s", owner, repo, path, branch, err);
            free(resp);
            return;
        }
        char *c = strstr(resp, "\"content\":\"");
        if (!c) {
            snprintf(result, rcap, "REPO_DIR %s/%s@%s:/%s\n%.1500s", owner, repo, branch, path, resp);
            free(resp);
            return;
        }
        c += strlen("\"content\":\"");
        char *cend = strchr(c, '"');
        if (cend) *cend = '\0';
        strip_escaped_newlines(c);
        char decoded[2048];
        base64_decode(c, decoded, sizeof(decoded));
        snprintf(result, rcap, "REPO_FILE %s/%s@%s:/%s\n%s", owner, repo, branch, path, decoded);
        free(resp);
        return;
    }

    char api_path[300];
    snprintf(api_path, sizeof(api_path), "/repos/%s/%s/git/trees/%s?recursive=1", owner, repo, branch);
    if (github_get(api_path, resp, GITHUB_RBUF, err, sizeof(err)) != 0) {
        snprintf(result, rcap, "ERROR: could not list tree for %s/%s@%s: %s", owner, repo, branch, err);
        free(resp);
        return;
    }

    char listing[1700] = "";
    int shown = 0;
    const char *p = resp;
    while (shown < 80) {
        const char *pp = strstr(p, "\"path\":\"");
        if (!pp) break;
        pp += strlen("\"path\":\"");
        const char *pe = strchr(pp, '"');
        if (!pe) break;
        char entry[220];
        size_t elen = (size_t)(pe - pp);
        if (elen >= sizeof(entry)) elen = sizeof(entry) - 1;
        memcpy(entry, pp, elen);
        entry[elen] = '\0';
        str_appendf(listing, sizeof(listing), "%s\n", entry);
        shown++;
        p = pe + 1;
    }
    snprintf(result, rcap,
             "REPO_TREE %s/%s@%s (%d entries shown)\n%s"
             "Use [PC_ACTION:read_repo|%s/%s@%s|path/to/file] to read one file.",
             owner, repo, branch, shown, listing, owner, repo, branch);
    free(resp);
}

/* Dispatcher — the ONLY five PC_ACTION types that exist. */
static void execute_pc_action(const char *type, const char *param, char *result, int rcap) {
    if (_stricmp(type, "status") == 0)          pc_status(result, rcap);
    else if (_stricmp(type, "list_processes") == 0) pc_list_processes(result, rcap);
    else if (_stricmp(type, "open_folder") == 0) pc_open_folder(result, rcap);
    else if (_stricmp(type, "run_young") == 0)   pc_run_young(param, result, rcap);
    else if (_stricmp(type, "read_repo") == 0)   pc_read_repo(param, result, rcap);
    else snprintf(result, rcap,
                  "ERROR: unknown PC_ACTION '%s' (allowed: status, list_processes, open_folder, run_young, read_repo)",
                  type);
}

/* ═══════════════════════════════════════════════════════════════════════════
   §6  LIVE AGENT
   ═══════════════════════════════════════════════════════════════════════════ */

static const char *LIVE_SYSTEM =
    "You are Young Oracle, a live coding AI for the Young language (.young files). "
    "You can read, create, and update .young project files by emitting FILE_ACTION blocks "
    "in the format: [FILE_ACTION:action|path|name|type|content]  where action is "
    "create|read|update|list. "
    "You can also check on or act within the user's real computer through a small fixed set of "
    "PC_ACTION commands: [PC_ACTION:type|param]  where type is one of: "
    "status (no param — disk/RAM summary), list_processes (no param), "
    "open_folder (no param — opens the project folder in Explorer), "
    "run_young|filename.young (runs an existing .young file in the project and returns its output), and "
    "read_repo|<github url or owner/repo>[@branch][|path/to/file] (no path lists the repo's file tree, "
    "a path reads that file's content — use this whenever the user gives you a GitHub link). "
    "There is no generic shell/run-command action — only those five. "
    "Work autonomously until the task is done: after you create or update a .young file, verify it with "
    "[PC_ACTION:run_young|name.young]; if the result starts with ERROR (it names the line, shows the code "
    "and the ritual call stack), fix that file and run it again. "
    "Reply concisely. Emit FILE_ACTIONs or PC_ACTIONs only when the request actually needs one.";

/* Build the full prompt for one live turn */
static void build_live_prompt(const char *user_msg, const char *tool_feedback,
                               char *out, int cap) {
    char tree[MAX_TREE];
    build_tree(tree, sizeof(tree));

    out[0] = '\0';
    str_appendf(out, cap,
        "Project root: %s\nProject .young files:\n%s\n\n", g_root, tree);

    /* inject history (last 10 turns) */
    int start = g_lhc > 10 ? g_lhc - 10 : 0;
    for (int i = start; i < g_lhc; i++) {
        str_appendf(out, cap, "[%s]: %s\n\n", g_lh[i].role, g_lh[i].text);
    }

    if (tool_feedback && tool_feedback[0]) {
        str_appendf(out, cap, "[TOOL_RESULT]: %s\n\n", tool_feedback);
    }

    str_appendf(out, cap, "[USER]: %s", user_msg);
}

/* Thread parameter for live turn */
typedef struct {
    HWND hwnd;
    char api_key[MAX_KBUF];
    char user_msg[2048];
} LiveParam;

static DWORD WINAPI live_turn_thread(LPVOID param) {
    LiveParam *lp = (LiveParam *)param;
    HWND hwnd   = lp->hwnd;
    char api_key[MAX_KBUF];
    char user_msg[2048];
    snprintf(api_key,  sizeof(api_key),  "%s", lp->api_key);
    snprintf(user_msg, sizeof(user_msg), "%s", lp->user_msg);
    free(lp);

    /* add user message to history */
    if (g_lhc < MAX_HIST) {
        snprintf(g_lh[g_lhc].role, sizeof(g_lh[0].role), "USER");
        snprintf(g_lh[g_lhc].text, sizeof(g_lh[0].text), "%s", user_msg);
        g_lhc++;
    }

    ClaudeOptions opts = {
        .model        = "claude-haiku-4-5",
        .max_tokens   = 1024,  /* room to re-emit a whole fixed .young file */
        .temperature  = 0.3,
        .system_prompt = LIVE_SYSTEM
    };
    const char *env_model = getenv("YOUNG_CLAUDE_MODEL");
    if (env_model && env_model[0]) opts.model = env_model;
    const char *env_tok = getenv("YOUNG_MAX_TOKENS");
    if (env_tok && env_tok[0]) {
        int t = atoi(env_tok);
        if (t >= 64 && t <= 2048) opts.max_tokens = t;
    }

    char *resp_buf = (char *)malloc(MAX_RBUF);
    char *err_buf  = (char *)malloc(512);
    if (!resp_buf || !err_buf) {
        free(resp_buf); free(err_buf);
        PostMessage(hwnd, WM_BUSY_CHANGE, 0, 0);
        return 0;
    }

    char tool_feedback[4096] = "";
    int  steps = 0;

    while (steps < 5) {
        char prompt[MAX_RBUF];
        build_live_prompt(user_msg, tool_feedback, prompt, sizeof(prompt));

        resp_buf[0] = '\0';
        err_buf[0]  = '\0';
        int rc = claude_message(api_key, prompt, &opts,
                                resp_buf, MAX_RBUF, err_buf, 512);

        if (rc != 0) {
            char *errcopy = _strdup(err_buf[0] ? err_buf : "Claude call failed");
            PostMessage(hwnd, WM_LIVE_APPEND, 1 /*is_error*/, (LPARAM)errcopy);
            break;
        }

        /* process FILE_ACTIONs */
        FileAction actions[8];
        int nacts = parse_file_actions(resp_buf, actions, 8);

        char stripped[MAX_RBUF];
        strip_file_actions(resp_buf, stripped, sizeof(stripped));

        /* model sometimes narrates a create without emitting the tag — recover it */
        int used_fallback = 0;
        if (nacts == 0 && try_fallback_file_action(stripped, &actions[0])) {
            nacts = 1;
            used_fallback = 1;
        }

        char visible[MAX_RBUF];
        strip_pc_actions(stripped, visible, sizeof(visible));

        /* process PC_ACTIONs (real-computer status/ops) */
        PcAction pcacts[4];
        int npcacts = parse_pc_actions(resp_buf, pcacts, 4);

        /* post visible response */
        if (visible[0]) {
            char *copy = _strdup(visible);
            PostMessage(hwnd, WM_LIVE_APPEND, 0, (LPARAM)copy);
        }

        if (nacts == 0 && npcacts == 0) break;  /* no tool calls, we're done */

        /* execute file actions, collect feedback */
        tool_feedback[0] = '\0';
        for (int i = 0; i < nacts; i++) {
            FileAction *fa = &actions[i];
            char res[4096] = "";
            if (_stricmp(fa->action, "create") == 0) {
                mc_create(fa->path[0] ? fa->path : fa->name, fa->content, res, sizeof(res));
            } else if (_stricmp(fa->action, "read") == 0) {
                mc_read(fa->path[0] ? fa->path : fa->name, res, sizeof(res));
            } else if (_stricmp(fa->action, "update") == 0) {
                mc_update(fa->path[0] ? fa->path : fa->name, fa->content, res, sizeof(res));
            } else if (_stricmp(fa->action, "list") == 0) {
                mc_list(res, sizeof(res));
            } else {
                snprintf(res, sizeof(res), "UNKNOWN action: %s", fa->action);
            }
            str_appendf(tool_feedback, sizeof(tool_feedback),
                        "[%s%s %s]: %s\n", (used_fallback && i == 0) ? "auto-detected " : "",
                        fa->action, fa->path[0] ? fa->path : fa->name, res);
        }

        /* execute PC actions, collect feedback, and echo each to the transcript
           so nothing touches the real machine invisibly */
        for (int i = 0; i < npcacts; i++) {
            PcAction *pa = &pcacts[i];
            char res[2048] = "";
            execute_pc_action(pa->type, pa->param, res, sizeof(res));

            /* full result: a run_young error report must not be cut short */
            char audit[2400];
            snprintf(audit, sizeof(audit), "%s(%s) -> %s",
                     pa->type, pa->param[0] ? pa->param : "-", res);
            char *auditcopy = _strdup(audit);
            if (auditcopy) PostMessage(hwnd, WM_LIVE_APPEND, 2, (LPARAM)auditcopy);

            str_appendf(tool_feedback, sizeof(tool_feedback),
                        "[PC_ACTION %s %s]: %s\n", pa->type, pa->param, res);
        }

        steps++;
    }

    /* add assistant turn to history */
    if (resp_buf && resp_buf[0] && g_lhc < MAX_HIST) {
        char stripped2[2048];
        strip_file_actions(resp_buf, stripped2, sizeof(stripped2));
        snprintf(g_lh[g_lhc].role, sizeof(g_lh[0].role), "ASSISTANT");
        snprintf(g_lh[g_lhc].text, sizeof(g_lh[0].text), "%.2040s", stripped2);
        g_lhc++;
    }

    free(resp_buf);
    free(err_buf);
    PostMessage(hwnd, WM_BUSY_CHANGE, 0, 0);
    return 0;
}

/* ═══════════════════════════════════════════════════════════════════════════
   §7  RUN .YOUNG FILE
   ═══════════════════════════════════════════════════════════════════════════ */

typedef struct { HWND hwnd; char script[MAX_PBUF]; } RunParam;

static DWORD WINAPI run_young_thread(LPVOID param) {
    RunParam *rp = (RunParam *)param;
    HWND hwnd = rp->hwnd;
    char script[MAX_PBUF];
    snprintf(script, sizeof(script), "%s", rp->script);
    free(rp);

    char python[MAX_PBUF];
    find_python(python, sizeof(python));

    char runner[MAX_PBUF];
    snprintf(runner, sizeof(runner), "%s\\young_runner.py", g_root);

    char cmd[MAX_PBUF * 3];
    snprintf(cmd, sizeof(cmd), "%s \"%s\" --timeout 25 \"%s\"", python, runner, script);

    char *out = (char *)malloc(MAX_RBUF);
    if (!out) {
        char *err = _strdup("ERROR: out of memory running script");
        if (err) PostMessage(hwnd, WM_LIVE_APPEND, 1, (LPARAM)err);
        return 0;
    }

    int code = run_hidden(cmd, out, MAX_RBUF, 30000);

    const char *base = strrchr(script, '\\');
    base = base ? base + 1 : script;

    char *msg = (char *)malloc(MAX_RBUF + 64);
    if (msg) {
        snprintf(msg, MAX_RBUF + 64, "%s\n%s", base, out[0] ? out : "(no output)");
        /* a failed run goes out as an error line (mode 1), shown in full */
        PostMessage(hwnd, WM_LIVE_APPEND, code == 0 ? 3 : 1, (LPARAM)msg);
    }
    free(out);
    return 0;
}

/* ═══════════════════════════════════════════════════════════════════════════
   §8  CONTROL CREATION HELPERS
   ═══════════════════════════════════════════════════════════════════════════ */

static HWND make_btn(HWND parent, const char *text, int id, DWORD style) {
    HWND h = CreateWindowExA(0, "BUTTON", text,
        WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON | style,
        0, 0, BTNW, BTNH, parent, (HMENU)(intptr_t)id, NULL, NULL);
    SendMessage(h, WM_SETFONT, (WPARAM)g_fui, TRUE);
    return h;
}

static HWND make_edit(HWND parent, int id, DWORD extra_style) {
    HWND h = CreateWindowExA(WS_EX_CLIENTEDGE, "EDIT", "",
        WS_CHILD | WS_VISIBLE | extra_style,
        0, 0, 100, BTNH, parent, (HMENU)(intptr_t)id, NULL, NULL);
    SendMessage(h, WM_SETFONT, (WPARAM)g_fmono, TRUE);
    return h;
}

static HWND make_multiline(HWND parent, int id) {
    HWND h = CreateWindowExA(WS_EX_CLIENTEDGE, "EDIT", "",
        WS_CHILD | WS_VISIBLE | ES_MULTILINE | ES_AUTOVSCROLL |
        ES_READONLY | WS_VSCROLL | WS_HSCROLL | ES_AUTOHSCROLL,
        0, 0, 200, 100, parent, (HMENU)(intptr_t)id, NULL, NULL);
    SendMessage(h, WM_SETFONT, (WPARAM)g_fmono, TRUE);
    return h;
}

static HWND make_label(HWND parent, const char *text, int id) {
    HWND h = CreateWindowExA(0, "STATIC", text,
        WS_CHILD | WS_VISIBLE | SS_LEFT,
        0, 0, 100, 18, parent, (HMENU)(intptr_t)id, NULL, NULL);
    SendMessage(h, WM_SETFONT, (WPARAM)g_fbold, TRUE);
    return h;
}

/* Shared STATIC/EDIT/BUTTON coloring for the small popup windows (settings,
   new-file prompt) — they all use the same flat dark-panel look. */
static LRESULT popup_color_msg(UINT msg, WPARAM wp) {
    HDC hdc = (HDC)wp;
    if (msg == WM_CTLCOLORSTATIC) {
        SetTextColor(hdc, C_TEXT); SetBkColor(hdc, C_BG2);
        return (LRESULT)g_br_bg2;
    }
    if (msg == WM_CTLCOLOREDIT) {
        SetTextColor(hdc, C_TEXT); SetBkColor(hdc, C_EDIT_BG);
        return (LRESULT)g_br_edit;
    }
    if (msg == WM_CTLCOLORBTN) {
        SetTextColor(hdc, C_TEXT); SetBkColor(hdc, C_BG2);
        return (LRESULT)g_br_bg2;
    }
    return 0;
}

/* ═══════════════════════════════════════════════════════════════════════════
   §9  MODAL TEXT PROMPT  (tiny nested-loop popup — used for "new file name")
   ═══════════════════════════════════════════════════════════════════════════ */

typedef struct { char *buf; int cap; BOOL ok; } PromptCtx;
static PromptCtx *g_prompt_ctx = NULL;
static BOOL g_prompt_active = FALSE;

static LRESULT CALLBACK prompt_wnd_proc(HWND hw, UINT msg, WPARAM wp, LPARAM lp) {
    if (msg == WM_CTLCOLORSTATIC || msg == WM_CTLCOLOREDIT || msg == WM_CTLCOLORBTN)
        return popup_color_msg(msg, wp);
    if (msg == WM_ERASEBKGND) {
        HDC hdc = (HDC)wp; RECT r; GetClientRect(hw, &r);
        FillRect(hdc, &r, g_br_bg2); return 1;
    }
    if (msg == WM_COMMAND) {
        int id = LOWORD(wp);
        if (id == IDOK) {
            if (g_prompt_ctx) {
                GetWindowTextA(GetDlgItem(hw, ID_PROMPT_EDIT), g_prompt_ctx->buf, g_prompt_ctx->cap);
                g_prompt_ctx->ok = TRUE;
            }
            g_prompt_active = FALSE;
            DestroyWindow(hw);
        } else if (id == IDCANCEL) {
            g_prompt_active = FALSE;
            DestroyWindow(hw);
        }
        return 0;
    }
    if (msg == WM_CLOSE) {
        g_prompt_active = FALSE;
        DestroyWindow(hw);
        return 0;
    }
    return DefWindowProcA(hw, msg, wp, lp);
}

/* Blocks (pumping messages, so background threads still deliver theirs) until
   the user picks OK/Cancel. `out` doubles as the initial text buffer. */
static BOOL modal_prompt(const char *title, const char *label, char *out, int cap) {
    static BOOL registered = FALSE;
    if (!registered) {
        WNDCLASSEXA wc = { sizeof(wc) };
        wc.hInstance = GetModuleHandle(NULL);
        wc.hCursor = LoadCursor(NULL, IDC_ARROW);
        wc.hbrBackground = g_br_bg2;
        wc.lpszClassName = "YoungPrompt";
        wc.lpfnWndProc = prompt_wnd_proc;
        RegisterClassExA(&wc);
        registered = TRUE;
    }

    PromptCtx ctx = { out, cap, FALSE };
    g_prompt_ctx = &ctx;
    EnableWindow(g_hwnd, FALSE);
    if (g_settings_hwnd) EnableWindow(g_settings_hwnd, FALSE);

    HWND hw = CreateWindowExA(WS_EX_DLGMODALFRAME, "YoungPrompt", title,
        WS_POPUP | WS_CAPTION | WS_SYSMENU,
        CW_USEDEFAULT, CW_USEDEFAULT, 380, 170, g_hwnd, NULL, GetModuleHandle(NULL), NULL);

    make_label(hw, label, 9201);
    HWND edit = make_edit(hw, ID_PROMPT_EDIT, ES_AUTOHSCROLL);
    SetWindowTextA(edit, out);
    HWND ok     = make_btn(hw, "OK",     IDOK,     BS_DEFPUSHBUTTON);
    HWND cancel = make_btn(hw, "Cancel", IDCANCEL, 0);

    MoveWindow(GetDlgItem(hw, 9201), PAD, PAD, 340, 18, TRUE);
    MoveWindow(edit,   PAD, PAD + 22, 340, BTNH, TRUE);
    MoveWindow(cancel, 380 - PAD - BTNW,           PAD + 22 + BTNH + PAD, BTNW, BTNH, TRUE);
    MoveWindow(ok,     380 - 2 * PAD - 2 * BTNW,   PAD + 22 + BTNH + PAD, BTNW, BTNH, TRUE);

    SetFocus(edit);
    SendMessage(edit, EM_SETSEL, 0, -1);
    ShowWindow(hw, SW_SHOW);
    g_prompt_active = TRUE;

    MSG m;
    while (g_prompt_active) {
        if (GetMessageA(&m, NULL, 0, 0) <= 0) { g_prompt_active = FALSE; break; }
        TranslateMessage(&m);
        DispatchMessageA(&m);
    }

    EnableWindow(g_hwnd, TRUE);
    if (g_settings_hwnd) EnableWindow(g_settings_hwnd, TRUE);
    SetForegroundWindow(g_hwnd);
    g_prompt_ctx = NULL;
    return ctx.ok;
}

/* ═══════════════════════════════════════════════════════════════════════════
   §10  SETTINGS POPUP  (API key + voice toggle — everything rarely touched
   lives here instead of cluttering the main view)
   ═══════════════════════════════════════════════════════════════════════════ */

static LRESULT CALLBACK settings_wnd_proc(HWND hw, UINT msg, WPARAM wp, LPARAM lp) {
    if (msg == WM_CTLCOLORSTATIC || msg == WM_CTLCOLOREDIT || msg == WM_CTLCOLORBTN)
        return popup_color_msg(msg, wp);
    if (msg == WM_ERASEBKGND) {
        HDC hdc = (HDC)wp; RECT r; GetClientRect(hw, &r);
        FillRect(hdc, &r, g_br_bg2); return 1;
    }
    if (msg == WM_COMMAND && LOWORD(wp) == ID_BTN_SETTINGS_CLOSE) {
        ShowWindow(hw, SW_HIDE);
        EnableWindow(g_hwnd, TRUE);
        SetForegroundWindow(g_hwnd);
        return 0;
    }
    if (msg == WM_CLOSE) {
        ShowWindow(hw, SW_HIDE);
        EnableWindow(g_hwnd, TRUE);
        SetForegroundWindow(g_hwnd);
        return 0;
    }
    return DefWindowProcA(hw, msg, wp, lp);
}

/* Built once at startup (hidden) so g_edit_api_key/g_chk_voice are always
   valid — Settings only ever shows/hides this window, never destroys it. */
static void create_settings_window(void) {
    WNDCLASSEXA wc = { sizeof(wc) };
    wc.hInstance = GetModuleHandle(NULL);
    wc.hCursor = LoadCursor(NULL, IDC_ARROW);
    wc.hbrBackground = g_br_bg2;
    wc.lpszClassName = "YoungSettings";
    wc.lpfnWndProc = settings_wnd_proc;
    RegisterClassExA(&wc);

    g_settings_hwnd = CreateWindowExA(WS_EX_DLGMODALFRAME, "YoungSettings", "Settings",
        WS_POPUP | WS_CAPTION | WS_SYSMENU,
        CW_USEDEFAULT, CW_USEDEFAULT, 420, 220, g_hwnd, NULL, GetModuleHandle(NULL), NULL);

    make_label(g_settings_hwnd, "ANTHROPIC_API_KEY", 9101);
    g_edit_api_key = make_edit(g_settings_hwnd, ID_EDIT_API_KEY, ES_AUTOHSCROLL | ES_PASSWORD);

    g_chk_voice = CreateWindowExA(0, "BUTTON", "Voice reply (text-to-speech)",
        WS_CHILD | WS_VISIBLE | BS_AUTOCHECKBOX,
        0, 0, 340, 24, g_settings_hwnd, (HMENU)(intptr_t)ID_CHK_VOICE, NULL, NULL);
    SendMessage(g_chk_voice, WM_SETFONT, (WPARAM)g_fui, TRUE);
    SendMessage(g_chk_voice, BM_SETCHECK, BST_CHECKED, 0);

    HWND close_btn = make_btn(g_settings_hwnd, "Close", ID_BTN_SETTINGS_CLOSE, BS_DEFPUSHBUTTON);

    MoveWindow(GetDlgItem(g_settings_hwnd, 9101), PAD, PAD, 380, 18, TRUE);
    MoveWindow(g_edit_api_key, PAD, PAD + 22, 380, BTNH, TRUE);
    MoveWindow(g_chk_voice,    PAD, PAD + 22 + BTNH + PAD, 340, 24, TRUE);
    MoveWindow(close_btn,      420 - PAD - BTNW, PAD + 22 + BTNH + PAD + 24 + PAD, BTNW, BTNH, TRUE);

    const char *ek = getenv("ANTHROPIC_API_KEY");
    if (ek && ek[0]) SetWindowTextA(g_edit_api_key, ek);
}

static void open_settings_popup(void) {
    EnableWindow(g_hwnd, FALSE);
    ShowWindow(g_settings_hwnd, SW_SHOW);
    SetForegroundWindow(g_settings_hwnd);
    SetFocus(g_edit_api_key);
}

/* ═══════════════════════════════════════════════════════════════════════════
   §11  MYCOMPUTER FILE PANEL
   ═══════════════════════════════════════════════════════════════════════════ */

static void populate_file_list(void) {
    SendMessage(g_list_files, LB_RESETCONTENT, 0, 0);
    char buf[MAX_TREE];
    mc_list(buf, sizeof(buf));
    if (strcmp(buf, "(none)") == 0) return;

    char *ctx = NULL;
    char *tok = strtok_s(buf, "\n", &ctx);
    while (tok) {
        if (tok[0]) SendMessageA(g_list_files, LB_ADDSTRING, 0, (LPARAM)tok);
        tok = strtok_s(NULL, "\n", &ctx);
    }
}

static void open_selected_file(void) {
    int idx = (int)SendMessage(g_list_files, LB_GETCURSEL, 0, 0);
    if (idx == LB_ERR) {
        g_selected_file[0] = '\0';
        edit_set(g_edit_file, "");
        return;
    }
    SendMessageA(g_list_files, LB_GETTEXT, idx, (LPARAM)g_selected_file);
    char content[MAX_RBUF] = "";
    mc_read(g_selected_file, content, sizeof(content));
    edit_set(g_edit_file, content);  /* .young files on disk are UTF-8 */
}

/* ═══════════════════════════════════════════════════════════════════════════
   §12  CREATE ALL CONTROLS  (single consolidated view)
   ═══════════════════════════════════════════════════════════════════════════ */

static void create_all_controls(HWND main_hwnd) {
    /* Header */
    HWND lbl_title = make_label(main_hwnd, "YOUNG", 9001);
    SendMessage(lbl_title, WM_SETFONT, (WPARAM)g_ftitle, TRUE);
    make_label(main_hwnd, "Ready.", 9003);
    make_btn(main_hwnd, "Settings", ID_BTN_SETTINGS, 0);

    /* MyComputer panel */
    make_label(main_hwnd, "MYCOMPUTER", 9010);
    make_btn(main_hwnd, "+ New", ID_BTN_FILE_NEW, 0);

    g_list_files = CreateWindowExA(WS_EX_CLIENTEDGE, "LISTBOX", "",
        WS_CHILD | WS_VISIBLE | LBS_NOTIFY | WS_VSCROLL,
        0, 0, 100, 100, main_hwnd, (HMENU)(intptr_t)ID_LIST_FILES, NULL, NULL);
    SendMessage(g_list_files, WM_SETFONT, (WPARAM)g_fmono, TRUE);

    g_edit_file = CreateWindowExA(WS_EX_CLIENTEDGE, "EDIT", "",
        WS_CHILD | WS_VISIBLE | ES_MULTILINE | ES_AUTOVSCROLL | ES_WANTRETURN |
        WS_VSCROLL | WS_HSCROLL | ES_AUTOHSCROLL,
        0, 0, 100, 100, main_hwnd, (HMENU)(intptr_t)ID_EDIT_FILE, NULL, NULL);
    SendMessage(g_edit_file, WM_SETFONT, (WPARAM)g_fmono, TRUE);

    make_btn(main_hwnd, "Save",   ID_BTN_FILE_SAVE,   0);
    make_btn(main_hwnd, "Run",    ID_BTN_FILE_RUN,    BS_DEFPUSHBUTTON);
    make_btn(main_hwnd, "Delete", ID_BTN_FILE_DELETE, 0);

    /* Chat */
    g_edit_live_out = make_multiline(main_hwnd, ID_EDIT_LIVE_OUT);
    g_edit_live_in  = make_edit(main_hwnd, ID_EDIT_LIVE_IN, ES_AUTOHSCROLL);
    SendMessageA(g_edit_live_in, EM_SETCUEBANNER, 0, (LPARAM)L"Pedile algo a Young Oracle…");

    make_btn(main_hwnd, "Mic",  ID_BTN_LIVE_MIC,  0);
    make_btn(main_hwnd, "Enviar",      ID_BTN_LIVE_SEND, BS_DEFPUSHBUTTON);

    populate_file_list();
}

/* ═══════════════════════════════════════════════════════════════════════════
   §13  LAYOUT
   ═══════════════════════════════════════════════════════════════════════════ */

static void do_layout(void) {
    RECT cr; GetClientRect(g_hwnd, &cr);
    int W = cr.right, H = cr.bottom;
    if (W < 640) W = 640;
    if (H < 420) H = 420;

    /* Header */
    MoveWindow(GetDlgItem(g_hwnd, 9001), PAD, 8, 200, 28, TRUE);
    MoveWindow(GetDlgItem(g_hwnd, 9003), PAD, 34, W - 2 * PAD - BTNW - PAD, 18, TRUE);
    MoveWindow(GetDlgItem(g_hwnd, ID_BTN_SETTINGS), W - PAD - BTNW - 20, (HDR_H - BTNH) / 2, BTNW + 20, BTNH, TRUE);

    /* Content area between header and input row */
    int content_y = HDR_H;
    int content_h = H - HDR_H - INROW_H - PAD;
    if (content_h < 120) content_h = 120;

    int right_w = MC_PANEL_W;
    int left_w = W - 3 * PAD - right_w;
    if (left_w < 240) { left_w = 240; right_w = W - 3 * PAD - left_w; }

    /* Left: chat transcript */
    MoveWindow(g_edit_live_out, PAD, content_y, left_w, content_h, TRUE);

    /* Right: MyComputer file panel */
    int rx = PAD + left_w + PAD;
    MoveWindow(GetDlgItem(g_hwnd, 9010), rx, content_y, right_w - BTNW - 20 - PAD, 18, TRUE);
    MoveWindow(GetDlgItem(g_hwnd, ID_BTN_FILE_NEW), rx + right_w - BTNW - 20, content_y - 3, BTNW + 20, 24, TRUE);

    int fy = content_y + 24;
    MoveWindow(g_list_files, rx, fy, right_w, FILELIST_H, TRUE);
    fy += FILELIST_H + PAD;

    int editor_h = content_y + content_h - fy - BTNH - PAD;
    if (editor_h < 60) editor_h = 60;
    MoveWindow(g_edit_file, rx, fy, right_w, editor_h, TRUE);
    fy += editor_h + PAD;

    int bw3 = (right_w - 2 * PAD) / 3;
    MoveWindow(GetDlgItem(g_hwnd, ID_BTN_FILE_SAVE),   rx,                   fy, bw3, BTNH, TRUE);
    MoveWindow(GetDlgItem(g_hwnd, ID_BTN_FILE_RUN),    rx + bw3 + PAD,       fy, bw3, BTNH, TRUE);
    MoveWindow(GetDlgItem(g_hwnd, ID_BTN_FILE_DELETE), rx + 2 * (bw3 + PAD), fy, bw3, BTNH, TRUE);

    /* Input row */
    int iy = H - INROW_H;
    int mic_w = 48, send_w = 96;
    int inw = W - 3 * PAD - mic_w - send_w;
    int iny = iy + (INROW_H - BTNH) / 2;
    MoveWindow(g_edit_live_in, PAD, iny, inw, BTNH, TRUE);
    MoveWindow(GetDlgItem(g_hwnd, ID_BTN_LIVE_MIC),  PAD + inw + PAD,               iny, mic_w,  BTNH, TRUE);
    MoveWindow(GetDlgItem(g_hwnd, ID_BTN_LIVE_SEND), PAD + inw + PAD + mic_w + PAD, iny, send_w, BTNH, TRUE);
}

/* ═══════════════════════════════════════════════════════════════════════════
   §14  LIVE SEND HELPER
   ═══════════════════════════════════════════════════════════════════════════ */

static void do_live_send(void) {
    if (g_live_busy) { set_status("Busy - please wait…"); return; }

    char msg[2048] = "";
    get_text_utf8(g_edit_live_in, msg, sizeof(msg));
    char *p = msg;
    while (*p == ' ' || *p == '\t') p++;
    if (!p[0]) return;

    char api_key[MAX_KBUF] = "";
    get_api_key(api_key, sizeof(api_key));
    if (!api_key[0]) {
        const char *env_key = getenv("ANTHROPIC_API_KEY");
        if (env_key && env_key[0])
            snprintf(api_key, sizeof(api_key), "%s", env_key);
        else {
            edit_append(g_edit_live_out, ">> Set your API key in Settings first.\r\n");
            open_settings_popup();
            return;
        }
    }

    edit_append(g_edit_live_out, "\r\n\xF0\x9F\xA7\x91 YOU: ");
    edit_append(g_edit_live_out, p);
    edit_append(g_edit_live_out, "\r\n");

    SetWindowTextA(g_edit_live_in, "");

    g_live_busy = TRUE;
    PostMessage(g_hwnd, WM_BUSY_CHANGE, 1, 0);
    set_status("Young Oracle is thinking…");

    LiveParam *lp2 = (LiveParam *)malloc(sizeof(LiveParam));
    if (!lp2) { g_live_busy = FALSE; return; }
    lp2->hwnd = g_hwnd;
    snprintf(lp2->api_key,  sizeof(lp2->api_key),  "%s", api_key);
    snprintf(lp2->user_msg, sizeof(lp2->user_msg), "%s", p);

    HANDLE ht = CreateThread(NULL, 0, live_turn_thread, lp2, 0, NULL);
    if (ht) CloseHandle(ht);
    else { free(lp2); g_live_busy = FALSE; }
}

/* ═══════════════════════════════════════════════════════════════════════════
   §15  MAIN WINDOW PROCEDURE
   ═══════════════════════════════════════════════════════════════════════════ */

static LRESULT CALLBACK main_wnd_proc(HWND hw, UINT msg, WPARAM wp, LPARAM lp) {
    switch (msg) {
    case WM_SIZE:
        do_layout();
        return 0;

    case WM_ERASEBKGND: {
        HDC hdc = (HDC)wp; RECT r; GetClientRect(hw, &r);
        FillRect(hdc, &r, g_br_bg);
        return 1;
    }

    case WM_CTLCOLORSTATIC: {
        HDC hdc = (HDC)wp; HWND hctrl = (HWND)lp;
        SetBkColor(hdc, C_BG);
        if (hctrl == GetDlgItem(hw, 9001)) SetTextColor(hdc, C_GOLD);       /* "YOUNG" wordmark */
        else if (hctrl == GetDlgItem(hw, 9010)) SetTextColor(hdc, C_HINT); /* "MYCOMPUTER" label */
        else SetTextColor(hdc, C_TEXT);                                    /* status text */
        return (LRESULT)g_br_bg;
    }

    case WM_CTLCOLOREDIT: {
        HDC hdc = (HDC)wp; HWND hctrl = (HWND)lp;
        if (hctrl == g_edit_live_out) {
            SetTextColor(hdc, C_TEXT); SetBkColor(hdc, C_OUT_LIVE);
            return (LRESULT)g_br_live;
        }
        SetTextColor(hdc, C_TEXT); SetBkColor(hdc, C_EDIT_BG);
        return (LRESULT)g_br_edit;
    }

    case WM_CTLCOLORLISTBOX: {
        HDC hdc = (HDC)wp;
        SetTextColor(hdc, C_TEXT); SetBkColor(hdc, C_EDIT_BG);
        return (LRESULT)g_br_edit;
    }

    case WM_CTLCOLORBTN: {
        HDC hdc = (HDC)wp;
        SetTextColor(hdc, C_TEXT); SetBkColor(hdc, C_BG);
        return (LRESULT)g_br_bg;
    }

    case WM_COMMAND: {
        int id = LOWORD(wp);
        switch (id) {

        case ID_BTN_SETTINGS:
            open_settings_popup();
            break;

        case ID_LIST_FILES:
            if (HIWORD(wp) == LBN_SELCHANGE) open_selected_file();
            break;

        case ID_BTN_FILE_NEW: {
            char name[256] = "ritual_new.young";
            if (modal_prompt("New File", "File name (.young):", name, sizeof(name))) {
                char res[512];
                mc_create(name, "", res, sizeof(res));
                set_status("%s", res);
                populate_file_list();
                if (strncmp(res, "OK", 2) == 0) {
                    int idx = (int)SendMessageA(g_list_files, LB_FINDSTRINGEXACT, (WPARAM)-1, (LPARAM)name);
                    if (idx != LB_ERR) {
                        SendMessageA(g_list_files, LB_SETCURSEL, idx, 0);
                        open_selected_file();
                    }
                }
            }
            break;
        }

        case ID_BTN_FILE_SAVE: {
            if (!g_selected_file[0]) { set_status("No file selected."); break; }
            char content[MAX_RBUF] = "";
            get_text_utf8(g_edit_file, content, sizeof(content));
            char res[512];
            mc_update(g_selected_file, content, res, sizeof(res));
            set_status("%s", res);
            break;
        }

        case ID_BTN_FILE_RUN: {
            if (!g_selected_file[0]) { set_status("No file selected."); break; }
            char full[MAX_PBUF];
            snprintf(full, sizeof(full), "%s\\%s", g_root, g_selected_file);
            set_status("Running %s…", g_selected_file);

            RunParam *rp = (RunParam *)malloc(sizeof(RunParam));
            if (!rp) break;
            rp->hwnd = hw;
            snprintf(rp->script, sizeof(rp->script), "%s", full);
            HANDLE ht = CreateThread(NULL, 0, run_young_thread, rp, 0, NULL);
            if (ht) CloseHandle(ht); else free(rp);
            break;
        }

        case ID_BTN_FILE_DELETE: {
            if (!g_selected_file[0]) { set_status("No file selected."); break; }
            char q[300];
            snprintf(q, sizeof(q), "Delete %s?", g_selected_file);
            if (MessageBoxA(hw, q, "Confirm delete", MB_YESNO | MB_ICONWARNING) == IDYES) {
                char res[512];
                mc_delete(g_selected_file, res, sizeof(res));
                set_status("%s", res);
                g_selected_file[0] = '\0';
                edit_set(g_edit_file, "");
                populate_file_list();
            }
            break;
        }

        case ID_BTN_LIVE_SEND:
            do_live_send();
            break;

        case ID_BTN_LIVE_MIC:
            if (g_live_busy) { set_status("Busy…"); break; }
            set_status("Listening…");
            mic_capture_async(hw);
            break;
        }
        return 0;
    }

    case WM_LIVE_APPEND: {
        char *text = (char *)lp;
        int mode = (int)wp;  /* 0=oracle reply  1=error  2=PC_ACTION audit  3=run output */
        if (text) {
            if (mode == 1) {
                edit_append(g_edit_live_out, "\r\n\xE2\x9A\xA0 ERROR: ");
                edit_append(g_edit_live_out, text);
                edit_append(g_edit_live_out, "\r\n");
            } else if (mode == 2) {
                edit_append(g_edit_live_out, "\r\n\xE2\x9A\x99 SYSTEM: ");
                edit_append(g_edit_live_out, text);
                edit_append(g_edit_live_out, "\r\n");
            } else if (mode == 3) {
                edit_append(g_edit_live_out, "\r\n\xE2\x96\xB6 RUN ");
                edit_append(g_edit_live_out, text);
                edit_append(g_edit_live_out, "\r\n");
            } else {
                edit_append(g_edit_live_out, "\r\n\xF0\x9F\x94\xAE ORACLE: ");
                edit_append(g_edit_live_out, text);
                edit_append(g_edit_live_out, "\r\n");
                if (SendMessage(g_chk_voice, BM_GETCHECK, 0, 0) == BST_CHECKED) {
                    speak_async(text);
                }
            }
            free(text);
        }
        return 0;
    }

    case WM_MIC_RESULT: {
        char *text = (char *)lp;
        if (text && text[0]) {
            SetWindowTextA(g_edit_live_in, text);
            SetFocus(g_edit_live_in);
            set_status("Mic captured: %s", text);
            free(text);
        } else {
            set_status("No speech recognised.");
            if (text) free(text);
        }
        return 0;
    }

    case WM_BUSY_CHANGE: {
        BOOL busy = (BOOL)wp;
        g_live_busy = busy;
        EnableWindow(GetDlgItem(g_hwnd, ID_BTN_LIVE_SEND), !busy);
        EnableWindow(GetDlgItem(g_hwnd, ID_BTN_LIVE_MIC),  !busy);
        if (!busy) set_status("Ready.");
        return 0;
    }

    case WM_STATUS_MSG: {
        char *text = (char *)lp;
        if (text) { set_status("%s", text); free(text); }
        return 0;
    }

    case WM_KEYDOWN:
        if (wp == VK_RETURN && GetFocus() == g_edit_live_in) {
            do_live_send();
            return 0;
        }
        break;

    case WM_DESTROY:
        if (g_settings_hwnd) DestroyWindow(g_settings_hwnd);
        DeleteObject(g_br_bg);
        DeleteObject(g_br_bg2);
        DeleteObject(g_br_edit);
        DeleteObject(g_br_live);
        DeleteObject(g_fui);
        DeleteObject(g_fmono);
        DeleteObject(g_fbold);
        DeleteObject(g_ftitle);
        PostQuitMessage(0);
        return 0;
    }
    return DefWindowProcA(hw, msg, wp, lp);
}

/* ═══════════════════════════════════════════════════════════════════════════
   §16  ENTER-TO-SEND SUBCLASS
   ═══════════════════════════════════════════════════════════════════════════ */

static WNDPROC g_orig_edit_proc = NULL;
static LRESULT CALLBACK live_edit_subclass(HWND hw, UINT msg, WPARAM wp, LPARAM lp) {
    if (msg == WM_KEYDOWN && wp == VK_RETURN && !(GetKeyState(VK_SHIFT) & 0x8000)) {
        do_live_send();
        return 0;
    }
    return CallWindowProcA(g_orig_edit_proc, hw, msg, wp, lp);
}

/* ═══════════════════════════════════════════════════════════════════════════
   §17  WINMAIN
   ═══════════════════════════════════════════════════════════════════════════ */

int WINAPI WinMain(HINSTANCE hInst, HINSTANCE hPrev, LPSTR lpCmdLine, int nCmdShow) {
    (void)hPrev; (void)lpCmdLine;

    CoInitializeEx(NULL, COINIT_APARTMENTTHREADED);

    INITCOMMONCONTROLSEX icc = { sizeof(icc), ICC_BAR_CLASSES | ICC_LISTVIEW_CLASSES };
    InitCommonControlsEx(&icc);

    char exe_path[MAX_PBUF];
    GetModuleFileNameA(NULL, exe_path, sizeof(exe_path));
    char *last_sep = strrchr(exe_path, '\\');
    if (last_sep) *last_sep = '\0';
    last_sep = strrchr(exe_path, '\\');
    if (last_sep) *last_sep = '\0';
    snprintf(g_root, sizeof(g_root), "%s", exe_path);

    g_br_bg   = CreateSolidBrush(C_BG);
    g_br_bg2  = CreateSolidBrush(C_BG2);
    g_br_edit = CreateSolidBrush(C_EDIT_BG);
    g_br_live = CreateSolidBrush(C_OUT_LIVE);

    NONCLIENTMETRICSA ncm = { sizeof(ncm) };
    SystemParametersInfoA(SPI_GETNONCLIENTMETRICS, sizeof(ncm), &ncm, 0);
    g_fui  = CreateFontIndirectA(&ncm.lfMessageFont);
    ncm.lfMessageFont.lfWeight = FW_BOLD;
    g_fbold = CreateFontIndirectA(&ncm.lfMessageFont);
    g_fmono = CreateFontA(-13, 0, 0, 0, FW_NORMAL, FALSE, FALSE, FALSE,
                          DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                          CLEARTYPE_QUALITY, FIXED_PITCH | FF_MODERN, "Consolas");
    g_ftitle = CreateFontA(-26, 0, 0, 0, FW_BOLD, FALSE, FALSE, FALSE,
                          DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                          CLEARTYPE_QUALITY, VARIABLE_PITCH | FF_ROMAN, "Cambria");

    WNDCLASSEXA wc = { sizeof(wc) };
    wc.hInstance     = hInst;
    wc.hCursor       = LoadCursor(NULL, IDC_ARROW);
    wc.hbrBackground = g_br_bg;
    wc.lpszClassName = "YoungStudioMain";
    wc.lpfnWndProc   = main_wnd_proc;
    wc.hIcon         = LoadIcon(NULL, IDI_APPLICATION);
    wc.hIconSm       = LoadIcon(NULL, IDI_APPLICATION);
    wc.style         = CS_HREDRAW | CS_VREDRAW;
    RegisterClassExA(&wc);

    g_hwnd = CreateWindowExA(0, "YoungStudioMain",
                              "Young - Oracle Live",
                              WS_OVERLAPPEDWINDOW,
                              CW_USEDEFAULT, CW_USEDEFAULT, 1040, 700,
                              NULL, NULL, hInst, NULL);

    create_all_controls(g_hwnd);
    create_settings_window();

    g_orig_edit_proc = (WNDPROC)SetWindowLongPtrA(g_edit_live_in, GWLP_WNDPROC,
                                                   (LONG_PTR)live_edit_subclass);

    {
        const char *ek = getenv("ANTHROPIC_API_KEY");
        if (ek && ek[0]) SetWindowTextA(g_edit_api_key, ek);
    }

    ShowWindow(g_hwnd, nCmdShow);
    UpdateWindow(g_hwnd);
    do_layout();

    edit_append(g_edit_live_out,
        "Bienvenido a Young.\r\n"
        "Ped\xC3\xADle a Young Oracle que cree, lea o actualice archivos .young, "
        "o simplemente charl\xC3\xA1 sobre tu proyecto.\r\n"
        "Ra\xC3\xADz del proyecto: ");
    edit_append(g_edit_live_out, g_root);
    edit_append(g_edit_live_out, "\r\n");

    MSG m;
    while (GetMessageA(&m, NULL, 0, 0)) {
        TranslateMessage(&m);
        DispatchMessageA(&m);
    }

    CoUninitialize();
    return (int)m.wParam;
}


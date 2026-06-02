#pragma once
/*
 * Force-included (clang-cl /FI) into every kalign translation unit on Windows to
 * supply the POSIX bits kalign uses but Windows/UCRT does not provide.
 * Kept deliberately light — no <windows.h> — to avoid macro clashes.
 */
#include <time.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>

/* POSIX ssize_t (used by kalign's I/O, e.g. lib/src/msa_io.c). */
#ifndef _SSIZE_T_DEFINED
#define _SSIZE_T_DEFINED
typedef ptrdiff_t ssize_t;
#endif

/* POSIX/GNU getline(): read a full line, growing the buffer as needed. kalign
 * uses it for stdin/file parsing (lib/src/msa_io.c). UCRT has no getline. */
#ifndef KALIGN_WIN_GETLINE
#define KALIGN_WIN_GETLINE
static __inline ssize_t getline(char **lineptr, size_t *n, FILE *stream) {
    size_t pos = 0;
    int c;
    if (lineptr == NULL || n == NULL || stream == NULL) {
        return -1;
    }
    if (*lineptr == NULL || *n == 0) {
        *n = 128;
        char *nb = (char *)realloc(*lineptr, *n);
        if (nb == NULL) {
            return -1;
        }
        *lineptr = nb;
    }
    for (;;) {
        c = fgetc(stream);
        if (c == EOF) {
            if (pos == 0) {
                return -1;
            }
            break;
        }
        if (pos + 1 >= *n) {
            size_t newcap = *n * 2;
            char *nb = (char *)realloc(*lineptr, newcap);
            if (nb == NULL) {
                return -1;
            }
            *lineptr = nb;
            *n = newcap;
        }
        (*lineptr)[pos++] = (char)c;
        if (c == '\n') {
            break;
        }
    }
    (*lineptr)[pos] = '\0';
    return (ssize_t)pos;
}
#endif

/* POSIX localtime_r / gmtime_r -> Windows *_s. Note the argument order differs:
 * POSIX is (const time_t*, struct tm*); Windows _s is (struct tm*, const time_t*). */
#ifndef localtime_r
#define localtime_r(timep, result) (localtime_s((result), (timep)) == 0 ? (result) : (struct tm *)0)
#endif
#ifndef gmtime_r
#define gmtime_r(timep, result) (gmtime_s((result), (timep)) == 0 ? (result) : (struct tm *)0)
#endif

/* POSIX clock_gettime(CLOCK_MONOTONIC_RAW, ...) used by kalign's timer macros
 * (lib/src/tldevel.h). UCRT has struct timespec and C11 timespec_get but no
 * clock_gettime, so provide a wall-clock-backed shim (timing only, not load-bearing). */
#ifndef CLOCK_MONOTONIC_RAW
#define CLOCK_REALTIME 0
#define CLOCK_MONOTONIC 1
#define CLOCK_MONOTONIC_RAW 4
static __inline int clock_gettime(int clk_id, struct timespec *ts) {
    (void)clk_id;
    return timespec_get(ts, TIME_UTC) == TIME_UTC ? 0 : -1;
}
#endif

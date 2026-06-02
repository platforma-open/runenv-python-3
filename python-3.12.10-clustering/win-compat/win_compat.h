#pragma once
/*
 * Force-included (clang-cl /FI) into every kalign translation unit on Windows to
 * supply the POSIX time helpers kalign uses but Windows/UCRT does not provide.
 * Kept deliberately light — no <windows.h> — to avoid macro clashes.
 */
#include <time.h>

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

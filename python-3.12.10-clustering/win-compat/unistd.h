#pragma once
/*
 * Minimal <unistd.h> shim so kalign's POSIX-leaning C compiles with clang-cl on
 * Windows. kalign only pulls <unistd.h> for getpid() (lib/src/tlrng.c), which
 * maps to the MSVC/UCRT _getpid().
 */
#include <process.h> /* _getpid */
#include <io.h>      /* _access and friends */

#ifndef getpid
#define getpid _getpid
#endif

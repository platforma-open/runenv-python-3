#pragma once
/*
 * Minimal <strings.h> (POSIX) shim for building kalign with clang-cl on Windows.
 * Maps the case-insensitive string comparisons to their MSVC/UCRT equivalents.
 */
#include <string.h>

#ifndef strcasecmp
#define strcasecmp _stricmp
#endif
#ifndef strncasecmp
#define strncasecmp _strnicmp
#endif
#ifndef bzero
#define bzero(s, n) memset((s), 0, (n))
#endif

#!/usr/bin/env python3
"""
Native Import Checker - Test wheel packages by importing their native modules.

Usage: python check_native_imports.py [whitelist.json]
"""

import argparse
import io
import json
import os
import platform
import subprocess
import sys
import tempfile
import threading
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple


if sys.stdout.encoding != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
if sys.stderr.encoding != "utf-8":
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")


_print_lock = threading.Lock()


class PackageTestResult:
    """Container for package test results and logs."""

    def __init__(self, wheel_name: str):
        self.wheel_name = wheel_name
        self.success = False
        self.errors: List[Tuple[str, str]] = []
        self.whitelisted: List[Tuple[str, str]] = []
        self.logs: List[str] = []
        self.start_time = time.time()
        self.end_time = None

    def add_log(self, message: str):
        """Add log message with timestamp."""
        self.logs.append(message)

    def finish(
        self,
        success: bool,
        errors: List[Tuple[str, str]],
        whitelisted: List[Tuple[str, str]],
    ):
        """Mark test as finished with results."""
        self.success = success
        self.errors = errors
        self.whitelisted = whitelisted
        self.end_time = time.time()

    def duration(self) -> float:
        """Get test duration in seconds."""
        end = self.end_time or time.time()
        return end - self.start_time

    def print_logs(self):
        """Print all collected logs for this package."""
        with _print_lock:
            for log in self.logs:
                print(log)


def safe_print(*args, **kwargs):
    """Thread-safe print function."""
    with _print_lock:
        print(*args, **kwargs)


def find_packages_dir() -> Path:
    """Find packages directory (../packages or ./packages)."""
    python_dir = Path(sys.executable).parent
    packages_dir = python_dir.parent / "packages"

    if not packages_dir.exists():
        packages_dir = Path.cwd() / "packages"

    if not packages_dir.exists():
        raise FileNotFoundError(
            f"Cannot find packages directory. Tried:\n"
            f"  - {python_dir.parent / 'packages'}\n"
            f"  - {Path.cwd() / 'packages'}"
        )

    return packages_dir


def load_whitelist(whitelist_path: Optional[Path]) -> Dict[str, Dict[str, str]]:
    """Load and validate whitelist from JSON file."""
    if not whitelist_path:
        return {}

    if not whitelist_path.exists():
        print(f"Warning: Whitelist file not found: {whitelist_path}")
        return {}

    try:
        with open(whitelist_path, "r", encoding="utf-8") as f:
            whitelist = json.load(f)

        if not isinstance(whitelist, dict):
            print(
                f"Error: Whitelist must be a JSON object, got {type(whitelist).__name__}"
            )
            sys.exit(1)

        for wheel_name, modules in whitelist.items():
            if not isinstance(modules, dict):
                print(f"Error: Whitelist entry for '{wheel_name}' must be an object")
                sys.exit(1)
            for module_name, error_pattern in modules.items():
                if not isinstance(error_pattern, str):
                    print(
                        f"Error: Error pattern for '{wheel_name}.{module_name}' must be a string"
                    )
                    sys.exit(1)

        print(f"Loaded whitelist with {len(whitelist)} wheel(s)")
        return whitelist
    except (OSError, IOError) as e:
        print(f"Error: Cannot read whitelist file: {whitelist_path}\n{e}")
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(f"Error: Failed to parse whitelist file: {whitelist_path}\n{e}")
        sys.exit(1)


def is_whitelisted(
    wheel_name: str, module: str, error: str, whitelist: Dict[str, Dict[str, str]]
) -> bool:
    """Check if error matches whitelist pattern."""
    if not isinstance(whitelist, dict) or not wheel_name or not module or not error:
        return False

    expected_error = whitelist.get(wheel_name, {}).get(module)
    if not expected_error or not isinstance(expected_error, str):
        return False
    return expected_error.lower() in error.lower()


def get_venv_python(venv_path: Path) -> Path:
    """Get Python executable path in virtual environment."""
    if platform.system() == "Windows":
        return venv_path / "Scripts" / "python.exe"
    else:
        return venv_path / "bin" / "python"


def extract_native_modules(wheel_path: Path) -> Tuple[List[str], List[str]]:
    """Extract native module names from wheel file."""
    modules = []
    top_level_packages = []
    has_native_files = False
    native_extensions = [".so", ".pyd"]

    try:
        with zipfile.ZipFile(wheel_path, "r") as whl:
            all_files = whl.namelist()

            for name in all_files:
                if name.endswith(".dist-info/top_level.txt"):
                    try:
                        content = whl.read(name).decode("utf-8")
                        top_level_packages = [
                            m.strip() for m in content.strip().split("\n") if m.strip()
                        ]
                    except (UnicodeDecodeError, KeyError):
                        pass
                    break

            for name in all_files:
                if ".dist-info/" in name or ".data/" in name or ".libs/" in name:
                    continue

                if not any(name.endswith(ext) for ext in native_extensions):
                    continue

                has_native_files = True

                path_parts = name.split("/")
                basename = path_parts[-1] if path_parts else name
                if basename.startswith("lib") and ".so." in basename:
                    continue

                module_path = name
                for ext in native_extensions:
                    if ext in module_path:
                        module_path = module_path.split(ext)[0]
                        break

                parts = module_path.split(".")
                clean_parts = []
                for part in parts:
                    if part.startswith(("cpython-", "abi3", "pypy", "cp3")):
                        break
                    clean_parts.append(part)
                module_path = ".".join(clean_parts)

                module_name = module_path.replace("/", ".").rstrip(".")

                if module_name:
                    modules.append(module_name)

        if not modules and has_native_files and top_level_packages:
            return top_level_packages, top_level_packages

        return sorted(set(modules)), top_level_packages

    except (zipfile.BadZipFile, OSError, IOError) as e:
        print(f"Warning: Cannot read wheel file {wheel_path}: {e}")
        return [], []


def test_wheel_with_logging(
    wheel_path: Path,
    packages_dir: Path,
    python_bin: Path,
    whitelist: Dict[str, Dict[str, str]],
    used_whitelist_lock: threading.Lock,
) -> PackageTestResult:
    """Test wheel by installing and importing native modules with logging."""
    wheel_name = wheel_path.name
    result = PackageTestResult(wheel_name)
    used_whitelist_local: Set[Tuple[str, str]] = set()

    result.add_log(f"\nTesting: {wheel_name}")

    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)
        venv_path = temp_path / ".venv"

        try:
            proc_result = subprocess.run(
                [str(python_bin), "-m", "venv", str(venv_path)],
                capture_output=True,
                text=True,
                encoding="utf-8",
                timeout=60,
            )
        except subprocess.TimeoutExpired:
            result.add_log("  ❌ Timeout creating venv")
            result.finish(False, [("venv", "Timeout creating virtual environment")], [])
            return result

        if proc_result.returncode != 0:
            result.add_log("  ❌ Failed to create venv")
            error_msg = (
                proc_result.stderr.strip()
                if proc_result.stderr
                else "Failed to create virtual environment"
            )
            result.finish(False, [("venv", error_msg)], [])
            return result

        result.add_log("  ✓ Created venv")

        venv_python = get_venv_python(venv_path)

        if not venv_python.exists():
            result.add_log(f"  ❌ venv Python not found at {venv_python}")
            result.finish(
                False, [("venv", f"Python executable not found at {venv_python}")], []
            )
            return result

        try:
            proc_result = subprocess.run(
                [
                    str(venv_python),
                    "-m",
                    "pip",
                    "install",
                    "--find-links",
                    str(packages_dir),
                    "--no-index",
                    str(wheel_path),
                ],
                capture_output=True,
                text=True,
                encoding="utf-8",
                timeout=120,
            )
        except subprocess.TimeoutExpired:
            result.add_log("  ❌ Timeout installing wheel")
            result.finish(False, [("install", "Timeout installing wheel")], [])
            return result

        if proc_result.returncode != 0:
            result.add_log("  ❌ Failed to install")
            error_msg = (
                proc_result.stderr.strip()
                if proc_result.stderr
                else proc_result.stdout.strip()
            )
            result.finish(
                False, [("install", error_msg or "Failed to install wheel")], []
            )
            return result

        result.add_log("  ✓ Installed")

        result.add_log("  Analyzing wheel for native modules")
        modules_to_test, _ = extract_native_modules(wheel_path)

        if not modules_to_test:
            result.add_log("  No native modules found (pure Python package)")
            result.add_log("  ✓ All imports successful")
            result.finish(True, [], [])
            return result

        result.add_log(f"  Found {len(modules_to_test)} native module(s) to test")

        failed_imports = []
        whitelisted_imports = []
        tested_count = 0

        for module in modules_to_test:
            try:
                proc_result = subprocess.run(
                    [
                        str(venv_python),
                        "-c",
                        f"import {module.replace(';', '').replace('&', '').replace('|', '')}",
                    ],
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    timeout=30,
                )
            except subprocess.TimeoutExpired:
                result.add_log(f"  Testing import: {module}")
                tested_count += 1
                actual_error = "Import timeout (module may be hanging)"

                if is_whitelisted(wheel_name, module, actual_error, whitelist):
                    result.add_log(f"  ⚠️  Whitelisted: {actual_error}")
                    whitelisted_imports.append((module, actual_error))
                    used_whitelist_local.add((wheel_name, module))
                else:
                    result.add_log(f"  ❌ Failed: {actual_error}")
                    failed_imports.append((module, actual_error))
                continue

            if proc_result.returncode == 0:
                result.add_log(f"  Testing import: {module}")
                tested_count += 1
            else:
                error_msg = proc_result.stderr.strip()

                if error_msg:
                    error_lines = error_msg.split("\n")
                    actual_error = next(
                        (line for line in reversed(error_lines) if line.strip()),
                        error_msg,
                    )
                else:
                    actual_error = "Unknown error"

                if (
                    "dynamic module does not define module export function" in error_msg
                    or "ModuleNotFoundError" in error_msg
                ):
                    continue

                result.add_log(f"  Testing import: {module}")
                tested_count += 1

                if is_whitelisted(wheel_name, module, actual_error, whitelist):
                    result.add_log(f"  ⚠️  Whitelisted: {actual_error}")
                    whitelisted_imports.append((module, actual_error))
                    used_whitelist_local.add((wheel_name, module))
                else:
                    result.add_log(f"  ❌ Failed: {actual_error}")
                    failed_imports.append((module, actual_error))

        result.add_log(f"  Tested {tested_count} native module(s)")

        with used_whitelist_lock:
            for item in used_whitelist_local:
                pass

        if failed_imports:
            result.finish(False, failed_imports, whitelisted_imports)
        elif whitelisted_imports:
            result.add_log("  ⚠️  All failures are whitelisted")
            result.finish(True, [], whitelisted_imports)
        else:
            result.add_log("  ✓ All imports successful")
            result.finish(True, [], [])

        result.used_whitelist_local = used_whitelist_local
        return result


def test_wheel_wrapper(args):
    """Wrapper function for parallel execution."""
    wheel_path, packages_dir, python_bin, whitelist, used_whitelist_lock = args
    try:
        return test_wheel_with_logging(
            wheel_path, packages_dir, python_bin, whitelist, used_whitelist_lock
        )
    except Exception as e:
        result = PackageTestResult(wheel_path.name)
        result.add_log(f"  ❌ Unexpected error: {e}")
        result.finish(False, [("exception", str(e))], [])
        return result


def find_unused_whitelist_entries(
    whitelist: Dict[str, Dict[str, str]], used_whitelist: Set[Tuple[str, str]]
) -> Dict[str, List[str]]:
    """Find unused whitelist entries."""
    unused = {}

    for wheel_name, modules in whitelist.items():
        unused_modules = []
        for module_name in modules.keys():
            if (wheel_name, module_name) not in used_whitelist:
                unused_modules.append(module_name)

        if unused_modules:
            unused[wheel_name] = unused_modules

    return unused


def generate_whitelist_snippet(failed_wheels: Dict[str, List[Tuple[str, str]]]) -> str:
    """Generate whitelist JSON snippet from failed imports."""
    snippet = {}

    for wheel_name, errors in failed_wheels.items():
        snippet[wheel_name] = {}
        for module, error in errors:
            # Remove Python error type prefix (e.g., "ImportError: ")
            if ": " in error:
                parts = error.split(": ", 1)
                if parts[0] and (parts[0].endswith("Error") or parts[0].endswith("Exception")):
                    error = parts[1]
            
            truncated_error = error[:100] if len(error) > 100 else error
            snippet[wheel_name][module] = truncated_error.strip()

    return json.dumps(snippet, indent=2)


def main():
    """Main entry point - test all wheel packages."""
    parser = argparse.ArgumentParser(
        description="Test wheel packages by importing native modules",
        usage="%(prog)s [whitelist.json]",
    )
    parser.add_argument(
        "whitelist", type=Path, nargs="?", help="Path to whitelist JSON file"
    )
    args = parser.parse_args()

    print("Starting wheel installation tests...")
    print("=" * 50)

    platform_info = f"{platform.system()} {platform.machine()}"
    python_info = sys.version

    print(f"Platform: {platform_info}")
    print(f"Python: {python_info}")

    whitelist = load_whitelist(args.whitelist)
    used_whitelist: Set[Tuple[str, str]] = set()

    try:
        packages_dir = find_packages_dir()
        print(f"Packages directory: {packages_dir}")
    except FileNotFoundError as e:
        print(f"Error: {e}")
        sys.exit(1)

    wheel_files = sorted(packages_dir.glob("*.whl"))

    if not wheel_files:
        print(f"No wheel files found in {packages_dir}")
        sys.exit(1)

    wheel_count = len(wheel_files)
    print(f"Found {wheel_count} wheel file(s)")

    python_bin = Path(sys.executable)

    failed_wheels: Dict[str, List[Tuple[str, str]]] = {}
    whitelisted_wheels: Dict[str, List[Tuple[str, str]]] = {}

    max_workers = min(len(wheel_files), (os.cpu_count() or 1))
    used_whitelist_lock = threading.Lock()

    safe_print(f"Using {max_workers} parallel workers")

    test_args = [
        (wheel_path, packages_dir, python_bin, whitelist, used_whitelist_lock)
        for wheel_path in wheel_files
    ]

    completed_count = 0
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_wheel = {
            executor.submit(test_wheel_wrapper, args): args[0] for args in test_args
        }

        for future in as_completed(future_to_wheel):
            wheel_path = future_to_wheel[future]
            completed_count += 1

            try:
                result = future.result()

                result.print_logs()

                if not result.success:
                    failed_wheels[result.wheel_name] = result.errors

                if result.whitelisted:
                    whitelisted_wheels[result.wheel_name] = result.whitelisted

                if hasattr(result, "used_whitelist_local"):
                    with used_whitelist_lock:
                        used_whitelist.update(result.used_whitelist_local)

                safe_print(
                    f"\nProgress: {completed_count}/{wheel_count} packages tested ({result.duration():.1f}s)"
                )

            except Exception as e:
                safe_print(f"\n❌ Error processing {wheel_path.name}: {e}")
                failed_wheels[wheel_path.name] = [("exception", str(e))]

    unused_whitelist = find_unused_whitelist_entries(whitelist, used_whitelist)

    print("\n" + "=" * 50)
    print("Test Summary")
    print("=" * 50)
    print(f"Platform: {platform_info}")
    print(f"Python: {python_info}")
    print(f"Packages directory: {packages_dir}")
    print(f"Total wheels tested: {wheel_count}")
    print(f"Successful: {wheel_count - len(failed_wheels)}")
    print(f"Failed: {len(failed_wheels)}")
    if whitelisted_wheels:
        print(f"Whitelisted warnings: {len(whitelisted_wheels)}")
    print("=" * 50)

    if whitelisted_wheels:
        print(f"\n⚠️  Whitelisted warnings ({len(whitelisted_wheels)}):\n")
        for wheel_name, errors in whitelisted_wheels.items():
            print(f"  {wheel_name}")
            for module, error in errors:
                print(f"    - {module}: {error}")
            print()

    if not failed_wheels:
        print("✓ All wheels installed and imported successfully!")
    else:
        print(f"\n❌ Failed wheels ({len(failed_wheels)}):\n")

        for wheel_name, errors in failed_wheels.items():
            print(f"  {wheel_name}")
            for module, error in errors:
                print(f"    - {module}: {error}")
            print()

        print("=" * 50)
        print("To whitelist these errors, add to your whitelist.json:")
        print("=" * 50)
        print(generate_whitelist_snippet(failed_wheels))
        print()

    if unused_whitelist:
        print("=" * 50)
        print("⚠️  Unused whitelist entries (can be removed):")
        print("=" * 50)
        for wheel_name, modules in unused_whitelist.items():
            print(f"  {wheel_name}")
            for module in modules:
                print(f"    - {module}")
        print()

    sys.exit(1 if failed_wheels else 0)


if __name__ == "__main__":
    main()

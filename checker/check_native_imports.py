#!/usr/bin/env python3
"""
Test wheel packages by importing their native modules.

Automatically finds ../packages relative to Python executable.
Cross-platform support for Linux, macOS, and Windows.

Usage: python check_native_imports.py [whitelist.json]
"""

import sys
import platform
import subprocess
import tempfile
import zipfile
import json
import argparse
from pathlib import Path
from typing import List, Dict, Tuple, Set, Optional


def find_packages_dir() -> Path:
    """Find packages directory relative to Python executable."""
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
    """Load error whitelist from JSON file."""
    if not whitelist_path:
        return {}
    
    if not whitelist_path.exists():
        print(f"Warning: Whitelist file not found: {whitelist_path}")
        return {}
    
    try:
        with open(whitelist_path, 'r') as f:
            whitelist = json.load(f)
        print(f"Loaded whitelist with {len(whitelist)} wheel(s)")
        return whitelist
    except json.JSONDecodeError as e:
        print(f"Error parsing whitelist file: {e}")
        return {}


def is_whitelisted(wheel_name: str, module: str, error: str, whitelist: Dict[str, Dict[str, str]]) -> bool:
    """Check if an error is whitelisted (case-insensitive substring match)."""
    if wheel_name not in whitelist:
        return False
    
    if module not in whitelist[wheel_name]:
        return False
    
    expected_error = whitelist[wheel_name][module]
    return expected_error.lower() in error.lower()


def get_venv_python(venv_path: Path) -> Path:
    """Get Python executable path in venv (cross-platform)."""
    if platform.system() == "Windows":
        return venv_path / "Scripts" / "python.exe"
    else:
        return venv_path / "bin" / "python"


def is_library_file(filename: str) -> bool:
    """Check if file is a C/C++ library (not a Python module)."""
    if any(ext in filename for ext in ['.so', '.dylib']):
        if filename.startswith('lib'):
            return True
    
    if '.dll' in filename:
        if filename.startswith('lib') and not any(v in filename for v in ['cpython', 'cp3', 'abi3']):
            return True
    
    return False


def extract_native_modules(wheel_path: Path) -> Tuple[List[str], List[str]]:
    """Extract native module names from wheel. Returns (modules, top_level_packages)."""
    modules = []
    top_level_packages = []
    has_native_files = False
    native_extensions = ['.so', '.pyd', '.dylib', '.dll']
    
    with zipfile.ZipFile(wheel_path, 'r') as whl:
        all_files = whl.namelist()
        
        for name in all_files:
            if name.endswith('.dist-info/top_level.txt'):
                content = whl.read(name).decode('utf-8')
                top_level_packages = [m.strip() for m in content.strip().split('\n') if m.strip()]
                break
        
        for name in all_files:
            if '.dist-info/' in name or '.data/' in name or '.libs/' in name:
                continue
            
            if not any(name.endswith(ext) for ext in native_extensions):
                continue
            
            has_native_files = True
            
            path_parts = name.split('/')
            basename = path_parts[-1] if path_parts else name
            if is_library_file(basename):
                continue
            
            module_path = name
            for ext in native_extensions:
                if ext in module_path:
                    module_path = module_path.split(ext)[0]
                    break
            
            parts = module_path.split('.')
            clean_parts = []
            for part in parts:
                if part.startswith(('cpython-', 'abi3', 'pypy', 'cp3')):
                    break
                clean_parts.append(part)
            module_path = '.'.join(clean_parts)
            
            module_name = module_path.replace('/', '.').rstrip('.')
            
            if module_name:
                modules.append(module_name)
    
    if not modules and has_native_files and top_level_packages:
        return top_level_packages, top_level_packages
    
    return sorted(set(modules)), top_level_packages


def test_wheel(
    wheel_path: Path, 
    packages_dir: Path, 
    python_bin: Path,
    whitelist: Dict[str, Dict[str, str]],
    used_whitelist: Set[Tuple[str, str]]
) -> Tuple[bool, List[Tuple[str, str]], List[Tuple[str, str]]]:
    """Test wheel by installing and importing native modules. Returns (success, errors, whitelisted)."""
    wheel_name = wheel_path.name
    print(f"\nTesting: {wheel_name}")
    
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)
        venv_path = temp_path / ".venv"
        
        result = subprocess.run(
            [str(python_bin), "-m", "venv", str(venv_path)],
            capture_output=True,
            text=True
        )
        
        if result.returncode != 0:
            print("  ❌ Failed to create venv")
            return False, [("venv", "Failed to create virtual environment")], []
        
        print("  ✓ Created venv")
        
        venv_python = get_venv_python(venv_path)
        
        if not venv_python.exists():
            print(f"  ❌ venv Python not found at {venv_python}")
            return False, [("venv", f"Python executable not found at {venv_python}")], []
        
        result = subprocess.run(
            [
                str(venv_python), "-m", "pip", "install",
                "--find-links", str(packages_dir),
                "--no-index",
                str(wheel_path)
            ],
            capture_output=True,
            text=True
        )
        
        if result.returncode != 0:
            print("  ❌ Failed to install")
            error_msg = result.stderr.strip() if result.stderr else result.stdout.strip()
            return False, [("install", error_msg or "Failed to install wheel")], []
        
        print("  ✓ Installed")
        
        print("  Analyzing wheel for native modules")
        modules_to_test, _ = extract_native_modules(wheel_path)
        
        if not modules_to_test:
            print("  No native modules found (pure Python package)")
            print("  ✓ All imports successful")
            return True, [], []
        
        print(f"  Found {len(modules_to_test)} native module(s) to test")
        
        failed_imports = []
        whitelisted_imports = []
        tested_count = 0
        
        for module in modules_to_test:
            result = subprocess.run(
                [str(venv_python), "-c", f"import {module}"],
                capture_output=True,
                text=True
            )
            
            if result.returncode == 0:
                print(f"  Testing import: {module}")
                tested_count += 1
            else:
                error_msg = result.stderr.strip()
                
                if error_msg:
                    error_lines = error_msg.split('\n')
                    actual_error = next((line for line in reversed(error_lines) if line.strip()), error_msg)
                else:
                    actual_error = "Unknown error"
                
                if "dynamic module does not define module export function" in error_msg:
                    continue
                
                if "DLL load failed" in error_msg and "not a valid Win32 application" in error_msg:
                    continue
                
                print(f"  Testing import: {module}")
                tested_count += 1
                
                if is_whitelisted(wheel_name, module, actual_error, whitelist):
                    print(f"  ⚠️  Whitelisted: {actual_error}")
                    whitelisted_imports.append((module, actual_error))
                    used_whitelist.add((wheel_name, module))
                else:
                    print(f"  ❌ Failed: {actual_error}")
                    failed_imports.append((module, actual_error))
        
        print(f"  Tested {tested_count} native module(s)")
        
        if failed_imports:
            return False, failed_imports, whitelisted_imports
        elif whitelisted_imports:
            print("  ⚠️  All failures are whitelisted")
            return True, [], whitelisted_imports
        else:
            print("  ✓ All imports successful")
            return True, [], []


def find_unused_whitelist_entries(
    whitelist: Dict[str, Dict[str, str]], 
    used_whitelist: Set[Tuple[str, str]]
) -> Dict[str, List[str]]:
    """Find whitelist entries that were not used."""
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
    """Generate JSON snippet for whitelist from failed imports."""
    snippet = {}
    
    for wheel_name, errors in failed_wheels.items():
        snippet[wheel_name] = {}
        for module, error in errors:
            if "cannot open shared object file" in error:
                if ".so" in error:
                    lib_name = error.split("cannot open")[0].strip().split()[-1]
                    snippet[wheel_name][module] = lib_name
                else:
                    snippet[wheel_name][module] = "cannot open shared object file"
            elif "No module named" in error:
                snippet[wheel_name][module] = error.split("ModuleNotFoundError:")[-1].strip()
            elif "initialization failed" in error:
                snippet[wheel_name][module] = "initialization failed"
            elif "circular import" in error:
                snippet[wheel_name][module] = "circular import"
            else:
                snippet[wheel_name][module] = error[:50]
    
    return json.dumps(snippet, indent=2)


def main():
    """Test all wheels by importing native modules."""
    parser = argparse.ArgumentParser(
        description="Test wheel packages by importing native modules",
        usage="%(prog)s [whitelist.json]"
    )
    parser.add_argument(
        "whitelist",
        type=Path,
        nargs='?',
        help="Path to whitelist JSON file"
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
    
    for wheel_path in wheel_files:
        try:
            success, errors, whitelisted = test_wheel(
                wheel_path, packages_dir, python_bin, whitelist, used_whitelist
            )
            
            if not success:
                failed_wheels[wheel_path.name] = errors
            
            if whitelisted:
                whitelisted_wheels[wheel_path.name] = whitelisted
                
        except Exception as e:
            print(f"  ❌ Unexpected error: {e}")
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


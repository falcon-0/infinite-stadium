"""Prepare a reviewable source tree from an explicitly selected tested release.

Does not commit, push, deploy, copy secrets or delete development evidence.
Uses the judge package allowlist; keeps meaningful tests and build tools.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys


def prepare(source, destination, documentation_root):
    source = Path(source).resolve()
    destination = Path(destination).resolve()
    documentation_root = Path(documentation_root).resolve()
    if not source.is_dir() or destination.exists() or destination.is_relative_to(source):
        raise ValueError("Choose an existing tested source and a new destination outside it.")
    # Load the chosen release's own allowlist, without importing application code.
    import importlib.util
    spec = importlib.util.spec_from_file_location("publication_package", source / "package_judge.py")
    package = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(package)
    names = set(package.REQUIRED_FILES)
    names.update(p.name for p in source.iterdir() if p.is_file() and not p.name.startswith('.') and p.suffix in package.SOURCE_SUFFIXES)
    files = {}
    for name in sorted(names):
        path = source / name
        if not package.allowed_source_name(name) or path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(source):
            raise ValueError("Invalid publication input: " + name)
        # Only these documentation files and ignore rules may come from the worktree.
        overlay = documentation_root / name
        if name == 'README.md' or name == '.gitignore' or name.startswith('docs/'):
            if not overlay.is_file() or overlay.is_symlink():
                raise ValueError("Missing documentation overlay: " + name)
            path = overlay
        files[name] = path.read_bytes()
    destination.mkdir(parents=True)
    for name, data in files.items():
        path = destination / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    # Keep this reproducible preparation tool in the public source as well.
    shutil.copy2(Path(__file__), destination / Path(__file__).name)
    subprocess.run([sys.executable, 'package_judge.py'], cwd=destination, check=True)
    subprocess.run([sys.executable, 'verify_judge_package.py', '--report', 'artifacts/judge/public-source-cleanroom.json'], cwd=destination, check=True)
    manifest = {name: hashlib.sha256(data).hexdigest() for name, data in files.items()}
    return {'source': str(source), 'destination': str(destination), 'sourceFiles': len(files) + (0 if Path(__file__).name in files else 1),
            'sourceHashes': manifest, 'scope': 'Allowlisted application, tests, tools and concise docs. Generated output, credentials, agent configuration and installed dependencies excluded. No Git commit, push or deployment.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True)
    parser.add_argument('--destination', required=True)
    parser.add_argument('--documentation-root', default='.')
    parser.add_argument('--report', required=True)
    args = parser.parse_args()
    report = Path(args.report)
    if report.exists():
        raise SystemExit('Preserve the previous report; choose a new filename.')
    result = prepare(args.source, args.destination, args.documentation_root)
    report.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'sourceFiles': result['sourceFiles'], 'destination': result['destination']}))

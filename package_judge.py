"""Build a reproducible source ZIP without credentials, dependencies or models."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import zipfile

ROOT = Path(__file__).resolve().parent
REQUIRED_FILES = (
    "README.md", "package.json", "package-lock.json", ".prettierrc.json", ".prettierignore", "docs/CONTRIBUTING.md", "requirements-local.txt", "requirements-local-lock.txt",
    "index.html", "style.css", "fan-experience.css", "Dockerfile", ".dockerignore",
    ".gitignore", ".env.example", "docs/VALIDATION_PLAN.md", "docs/RESEARCH.md",
    "docs/JUDGE_SETUP.md", "docs/SUBMISSION.md", "docs/DEMO_SCRIPT.md", "docs/DEVELOPMENT_HISTORY.md",
    "docs/DEPLOYMENT.md", "docs/SUBMISSION_HISTORY.md", "docs/EVALUATION_EVIDENCE.json",
    "test-fixtures/semantic-obligations-acceptance-v1.json",
    ".github/workflows/verify.yml",
    "vercel.json", ".vercelignore", "api/index.js",
)
SOURCE_SUFFIXES = {".js", ".py", ".ps1"}


def allowed_source_name(name):
    """Only named assets/docs and root source files may enter the distribution."""
    path = PurePosixPath(name)
    if any(character in name for character in ("\\", ":", "\0")) or path.is_absolute() or any(part in (".", "..") for part in name.split("/")):
        return False
    return name in REQUIRED_FILES or (
        len(path.parts) == 1 and not name.startswith(".") and path.suffix in SOURCE_SUFFIXES
    )


def build_archive(root=ROOT):
    root = Path(root).resolve()
    files = {root / name for name in REQUIRED_FILES}
    for suffix in SOURCE_SUFFIXES:
        files.update(path for path in root.glob("*" + suffix) if not path.name.startswith("."))
    if any(not path.is_file() or path.is_symlink() or not path.resolve().is_relative_to(root) for path in files):
        raise RuntimeError("Packaging input is missing, a symlink, or outside the project.")
    sources = {path.relative_to(root).as_posix(): path.read_bytes() for path in sorted(files)}
    manifest = {name: hashlib.sha256(data).hexdigest() for name, data in sources.items()}
    destination = root / "artifacts" / "judge"
    if any(path.is_symlink() for path in (root / "artifacts", destination)):
        raise RuntimeError("The build destination must not be a symlink.")
    destination.mkdir(parents=True, exist_ok=True)
    if not destination.resolve().is_relative_to(root):
        raise RuntimeError("The build destination is outside the project.")
    archive = destination / "infinite-stadium-test-build.zip"
    if archive.is_symlink():
        raise RuntimeError("The build archive must not be a symlink.")
    sources["BUILD_MANIFEST.json"] = (json.dumps(manifest, indent=2, sort_keys=True) + "\n").encode()
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as bundle:
        for name, data in sorted(sources.items()):
            info = zipfile.ZipInfo("infinite-stadium/" + name, date_time=(1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            bundle.writestr(info, data, compresslevel=9)
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    checksum = destination / "infinite-stadium-test-build.sha256"
    if checksum.is_symlink():
        raise RuntimeError("The build checksum must not be a symlink.")
    checksum.write_text(digest + "\n", encoding="ascii")
    return {"archive": str(archive), "sourceFiles": len(manifest), "sha256": digest}


if __name__ == "__main__":
    result = build_archive()
    print(f"Test build: {result['archive']}\nSource files: {result['sourceFiles']}\nSHA256: {result['sha256']}")

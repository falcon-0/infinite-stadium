"""Verify and run the source ZIP in a temporary clean directory. No installs or AI calls."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import socket
import stat
import subprocess
import tempfile
import time
from urllib.parse import urljoin, urlparse
from urllib.request import ProxyHandler, build_opener
import zipfile

from package_judge import REQUIRED_FILES, ROOT, allowed_source_name

PREFIX = "infinite-stadium/"
MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024


def checked_contents(archive):
    """Validate before extraction; reject extra files, traversal and bad hashes."""
    with zipfile.ZipFile(archive) as bundle:
        members = bundle.infolist()
        if len(members) > 512 or sum(member.file_size for member in members) > MAX_UNCOMPRESSED_BYTES:
            raise ValueError("Archive exceeds the bounded source distribution size.")
        names = [member.filename for member in members]
        if len({name.casefold() for name in names}) != len(names):
            raise ValueError("Archive contains duplicate or case-colliding names.")
        for member in members:
            name = member.filename
            if not name.startswith(PREFIX) or member.is_dir() or stat.S_ISLNK(member.external_attr >> 16):
                raise ValueError("Archive has an unexpected root, directory or symlink.")
            relative = name[len(PREFIX):]
            if relative != "BUILD_MANIFEST.json" and not allowed_source_name(relative):
                raise ValueError("Archive contains a file outside the source allowlist.")
        try:
            manifest = json.loads(bundle.read(PREFIX + "BUILD_MANIFEST.json"))
        except (KeyError, ValueError) as error:
            raise ValueError("Archive has no valid build manifest.") from error
        if not isinstance(manifest, dict) or any(not isinstance(name, str) or not isinstance(digest, str)
                or not re.fullmatch(r"[a-f0-9]{64}", digest) or not allowed_source_name(name)
                for name, digest in manifest.items()):
            raise ValueError("Build manifest has an invalid source name or digest.")
        expected = {PREFIX + name for name in manifest} | {PREFIX + "BUILD_MANIFEST.json"}
        if set(names) != expected or not set(REQUIRED_FILES).issubset(manifest) or "server.js" not in manifest:
            raise ValueError("Archive contents do not exactly match the required source manifest.")
        contents = {}
        for name, digest in manifest.items():
            data = bundle.read(PREFIX + name)
            if hashlib.sha256(data).hexdigest() != digest:
                raise ValueError("A packaged source hash does not match its manifest.")
            contents[name] = data
        contents["BUILD_MANIFEST.json"] = bundle.read(PREFIX + "BUILD_MANIFEST.json")
        return contents


def sanitized_environment(port):
    # Credentials, model paths, Node preload options and development budgets are
    # intentionally absent from the child environment.
    names = {"PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "COMSPEC", "PATHEXT"}
    env = {key: value for key, value in os.environ.items() if key.upper() in names}
    env.update({"HOST": "127.0.0.1", "PORT": str(port), "NODE_ENV": "test"})
    return env


def local_smoke(site):
    node = shutil.which("node")
    if not node:
        raise RuntimeError("Install Node.js 20 or newer before this check; the verifier installs nothing.")
    version = subprocess.check_output([node, "--version"], env=sanitized_environment(1), text=True).strip()
    if int(version.lstrip("v").split(".")[0]) < 20:
        raise RuntimeError("Node.js 20 or newer is required.")
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    origin = f"http://127.0.0.1:{port}"
    opener = build_opener(ProxyHandler({}))
    checks = []

    def request(path):
        with opener.open(origin + path, timeout=5) as response:
            return response.read(MAX_UNCOMPRESSED_BYTES + 1), response.headers.get("Content-Type", "")

    def get_json(path):
        return json.loads(request(path)[0])

    log_path = site.parent / "cleanroom-server.log"
    with log_path.open("w", encoding="utf-8") as log:
        process = subprocess.Popen([node, "server.js"], cwd=site, env=sanitized_environment(port),
                                   stdout=log, stderr=subprocess.STDOUT,
                                   creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        try:
            deadline = time.monotonic() + 12
            while True:
                if process.poll() is not None:
                    raise RuntimeError("Packaged server exited before becoming healthy: " + log_path.read_text()[-1500:])
                try:
                    if get_json("/api/health").get("healthy"):
                        break
                except OSError:
                    pass
                if time.monotonic() >= deadline:
                    raise RuntimeError("Packaged server did not become healthy within 12 seconds.")
                time.sleep(.1)
            checks.append("packaged server starts on an isolated loopback port")
            html = request("/")[0].decode("utf-8")
            queue = re.findall(r'(?:src|href)=["\']([^"\']+)["\']', html)
            visited = set()
            while queue:
                path = queue.pop()
                if not path.startswith("/") or path in visited or not path.endswith((".js", ".css")):
                    continue
                data, content_type = request(path)
                expected_type = "javascript" if path.endswith(".js") else "text/css"
                if expected_type not in content_type or not data:
                    raise RuntimeError("Browser asset is missing or has an incorrect content type: " + path)
                visited.add(path)
                if path.endswith(".js"):
                    source = data.decode("utf-8")
                    imports = re.findall(r'(?:import|export)\s+(?:[^;\n]*?\s+from\s+)?["\']([^"\']+)["\']', source)
                    imports += re.findall(r'import\(\s*["\']([^"\']+)["\']', source)
                    for target in imports:
                        if target.startswith((".", "/")):
                            queue.append(urlparse(urljoin(origin + path, target)).path)
            if "/stream-ui.js" not in visited or "/fan-experience.css" not in visited:
                raise RuntimeError("Current match UI and stylesheet were not reached from the packaged page.")
            checks.append(f"{len(visited)} browser assets and recursive local module imports are served")
            # Static packaging check, not a claim that Docker executed.
            dockerfile = (site / "Dockerfile").read_text(encoding="utf-8")
            copied = {token for line in dockerfile.splitlines() if line.startswith("COPY ") for token in line.split()[1:-1]}
            if any(path.lstrip("/") not in copied for path in visited if path.endswith(".css")):
                raise RuntimeError("Dockerfile omits a required browser stylesheet from COPY.")
            checks.append("Dockerfile includes required stylesheets (static check only)")
            for observed, expected_score in ((117, 0), (118, 1)):
                bundle = get_json(f"/api/match?kind=sustained&seed=17&time={observed}&language=en")
                if not bundle["state"]["metadata"]["synthetic"] or bundle["recap"]["score"]["home"] != expected_score:
                    raise RuntimeError("Packaged match did not preserve pending-to-confirmed goal behavior.")
            checks.append("synthetic match preserves the received goal confirmation")
            status = get_json("/api/ai/status")
            if status.get("configured") or status.get("connected") or status.get("available"):
                raise RuntimeError("Cleanroom unexpectedly has a configured AI provider.")
            checks.append("AI is unconfigured; no credentials, model runtime or model call needed")
            stream = request("/api/stream?kind=sustained&seed=17&time=117&speed=12")[0].decode("utf-8")
            messages = [json.loads(block.split("data: ", 1)[1]) for block in stream.split("\n\n") if "event: match\n" in block]
            if [message["time"] for message in messages] != [117, 118, 119, 120] or "event: complete" not in stream:
                raise RuntimeError("Packaged SSE did not finish the expected received sequence.")
            if any(frame["time"] > message["time"] for message in messages for frame in message["positions"]["upserts"]):
                raise RuntimeError("SSE included an unreceived positional sample.")
            checks.append("SSE streams received samples through completion")
            return {"node": version, "checks": checks, "browserAssets": sorted(visited), "cloudCalls": 0,
                    "scope": "Isolated source extraction on this computer; not independent hardware or visual user testing."}
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)


def verify_package(archive):
    archive = Path(archive).resolve()
    archive_bytes = archive.read_bytes()
    contents = checked_contents(io.BytesIO(archive_bytes))
    temp_parent = Path(tempfile.gettempdir()).resolve()
    with tempfile.TemporaryDirectory(prefix="infinite-stadium-cleanroom-", dir=temp_parent) as temporary:
        run_root = Path(temporary).resolve()
        if run_root.parent != temp_parent or not run_root.name.startswith("infinite-stadium-cleanroom-"):
            raise RuntimeError("Unexpected cleanroom location.")
        site = run_root / "infinite-stadium"
        for name, data in contents.items():
            target = site.joinpath(*PurePosixPath(name).parts)
            if not target.resolve().is_relative_to(run_root):
                raise RuntimeError("Extraction would leave the cleanroom.")
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        result = local_smoke(site)
    return {"passed": True, "archive": str(archive), "sha256": hashlib.sha256(archive_bytes).hexdigest(),
            "sourceFiles": len(contents) - 1, **result}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", nargs="?", type=Path, default=ROOT / "artifacts/judge/infinite-stadium-test-build.zip")
    parser.add_argument("--report", type=Path, help="Write JSON to this existing parent directory.")
    args = parser.parse_args()
    result = verify_package(args.archive)
    output = json.dumps(result, indent=2) + "\n"
    if args.report:
        args.report.write_text(output, encoding="utf-8")
    print(output, end="")

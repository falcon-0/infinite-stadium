param([switch]$SkipModelDownload)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
foreach ($requiredTool in @('node', 'python', 'ollama')) {
    if (-not (Get-Command $requiredTool -ErrorAction SilentlyContinue)) {
        throw "Install $requiredTool first; see README.md."
    }
}
if (-not (Test-Path -LiteralPath '.venv\Scripts\python.exe')) {
    python -m venv .venv
    if ($LASTEXITCODE -ne 0) { throw 'Unable to create the Python environment.' }
}
& '.\.venv\Scripts\python.exe' -m pip install -r requirements-local.txt -c requirements-local-lock.txt
if ($LASTEXITCODE -ne 0) { throw 'Python package installation failed.' }
& '.\.venv\Scripts\python.exe' -m pip check
if ($LASTEXITCODE -ne 0) { throw 'Python dependencies are inconsistent.' }
if (-not $SkipModelDownload) {
    ollama pull qwen3:4b
    if ($LASTEXITCODE -ne 0) { throw 'Model download failed. Start Ollama and retry.' }
}
Write-Host 'Setup complete. Run npm run start:local, then open http://127.0.0.1:4173.'

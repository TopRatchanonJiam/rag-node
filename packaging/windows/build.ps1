# สร้าง 1n9.exe จากโค้ด node ชุดเดียวกับ Docker
# ใช้: powershell -File packaging\windows\build.ps1 [-Python <python.exe>] [-Out <โฟลเดอร์>]
# ต้องมี: Python 3.13, Node.js 20 (build หน้าเว็บ) — build หน้าเว็บให้อัตโนมัติถ้ายังไม่มี frontend\out
param(
    [string]$Python = "python",
    [string]$Out = "$PSScriptRoot\dist"
)
$ErrorActionPreference = "Stop"
$node = Resolve-Path "$PSScriptRoot\..\.."
$venv = "$Out\.venv"

if (-not (Test-Path "$node\frontend\out\index.html")) {
    Push-Location "$node\frontend"; npm ci --no-audit --no-fund; npm run build; Pop-Location
}
& $Python -m venv $venv
& "$venv\Scripts\python.exe" -m pip install -q -r "$node\requirements.txt" pyinstaller

& "$venv\Scripts\pyinstaller.exe" --noconfirm --clean --onedir --name 1n9 `
    --distpath $Out --workpath "$Out\work" --specpath "$Out\work" `
    --paths $node `
    --add-data "$node\frontend\out;web" `
    --collect-submodules uvicorn --collect-submodules websockets `
    --hidden-import app --hidden-import legacy_api --hidden-import tunnel_client `
    --exclude-module tkinter --exclude-module pytest `
    "$PSScriptRoot\launcher.py"

Write-Host "`nเสร็จ: $Out\1n9\1n9.exe"

# สร้าง 1n9.exe จากโค้ด node ชุดเดียวกับ Docker
# ใช้: powershell -File packaging\windows\build.ps1 [-Python <python.exe>] [-Out <โฟลเดอร์>]
# ต้องมี: Python 3.13, Node.js 20 (build หน้าเว็บ) — build หน้าเว็บให้อัตโนมัติถ้ายังไม่มี frontend\out
param(
    [string]$Python = "python",
    [string]$Out = "$PSScriptRoot\dist",
    [string]$Version = "0.0.0"
)
$ErrorActionPreference = "Stop"
$node = Resolve-Path "$PSScriptRoot\..\.."
$venv = "$Out\.venv"

if (-not (Test-Path "$node\frontend\out\index.html")) {
    Push-Location "$node\frontend"; npm ci --no-audit --no-fund; npm run build; Pop-Location
}
# Qdrant สำเร็จรูปของ Windows (เวอร์ชันเดียวกับ docker-compose) — ตรวจ SHA256 ทุกครั้ง
# ตอนอัปเดตเวอร์ชัน: เทียบกับหน้า release ของ Qdrant ก่อนแก้ค่านี้
$qdrantVersion = "1.19.2"
$qdrantSha256 = "7d86596f16c6e85d45a50312f5e16ccb51e059b62e3d7308110cb65b4c799a4d"
$cache = "$Out\.cache"
New-Item -ItemType Directory -Force $cache | Out-Null
$zip = "$cache\qdrant-$qdrantVersion.zip"
if (-not (Test-Path $zip)) {
    Invoke-WebRequest "https://github.com/qdrant/qdrant/releases/download/v$qdrantVersion/qdrant-x86_64-pc-windows-msvc.zip" -OutFile $zip
}
if ((Get-FileHash $zip -Algorithm SHA256).Hash.ToLower() -ne $qdrantSha256) {
    Remove-Item $zip; throw "SHA256 ของ Qdrant ไม่ตรง — ไม่ใช้ไฟล์นี้"
}
Expand-Archive $zip -DestinationPath "$cache\qdrant-$qdrantVersion" -Force

& $Python -m venv $venv
& "$venv\Scripts\python.exe" -m pip install -q -r "$node\requirements.txt" -r "$PSScriptRoot\requirements.txt" pyinstaller

& "$venv\Scripts\pyinstaller.exe" --noconfirm --clean --onedir --noconsole --icon "$PSScriptRoot\1n9.ico" --name 1n9 `
    --distpath $Out --workpath "$Out\work" --specpath "$Out\work" `
    --paths $node `
    --add-data "$node\frontend\out;web" `
    --add-binary "$cache\qdrant-$qdrantVersion\qdrant.exe;qdrant" `
    --add-data "$PSScriptRoot\1n9.ico;." `
    --hidden-import qdrant_runner `
    --collect-submodules uvicorn --collect-submodules websockets `
    --hidden-import app --hidden-import legacy_api --hidden-import tunnel_client --hidden-import line_channel `
    --exclude-module tkinter --exclude-module pytest `
    "$PSScriptRoot\launcher.py"

Write-Host "`nเสร็จ: $Out\1n9\1n9.exe"

# ตัวติดตั้ง (ข้ามได้ถ้าไม่มี Inno Setup: winget install JRSoftware.InnoSetup)
$iscc = @("$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe", "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe") |
    Where-Object { Test-Path $_ } | Select-Object -First 1
if ($iscc) {
    & $iscc /Qp "/DAppVersion=$Version" "/DSourceDir=$Out\1n9" "/O$Out" "$PSScriptRoot\installer.iss"
    Write-Host "ตัวติดตั้ง: $Out\1n9-Setup.exe"
} else {
    Write-Host "ไม่พบ Inno Setup — ข้ามการสร้างตัวติดตั้ง"
}

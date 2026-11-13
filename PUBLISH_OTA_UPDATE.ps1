param(
    [string]$Version = "",
    [string]$Notes = "UI, player & speed improvements (zero-APK OTA)",
    [string]$KeyPath = "C:\Users\Anant\Downloads\ssh-key-2026-11-10 (2).key",
    [string]$ServerHost = "opc@130.210.49.14"
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$appDir = Join-Path $root "app"
$distDir = Join-Path $appDir "dist"
$zipPath = Join-Path $root "ota_bundle_upload.zip"

Write-Host "1. Building production web bundle..." -ForegroundColor Cyan
Push-Location $appDir
try {
    npm run build
} finally {
    Pop-Location
}

if (-not (Test-Path (Join-Path $distDir "index.html"))) {
    throw "Build failed: dist/index.html not found."
}

Write-Host "2. Packaging zip & computing SHA-256..." -ForegroundColor Cyan
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path (Join-Path $distDir "*") -DestinationPath $zipPath -CompressionLevel Optimal
$sha = (Get-FileHash -Path $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()

Write-Host "3. Checking current OTA code on $ServerHost..." -ForegroundColor Cyan
$curJson = ssh -i $KeyPath -o StrictHostKeyChecking=no $ServerHost "cat /home/opc/metube/server/ota_releases/manifest.json 2>/dev/null || echo '{}'"
try {
    $curObj = $curJson | ConvertFrom-Json
    $nextCode = [int]($curObj.ota_code) + 1
} catch {
    $nextCode = 2
}
if ($nextCode -lt 2) { $nextCode = 2 }
if (-not $Version) { $Version = "2.0.$nextCode" }

$manifest = @{
    ota_code = $nextCode
    ota_version = $Version
    native_version_code = 1
    title = "MeTube v$Version"
    notes = $Notes
    sha256 = $sha
} | ConvertTo-Json

$manifestTmp = Join-Path $root "ota_manifest_upload.json"
[System.IO.File]::WriteAllText($manifestTmp, $manifest, [System.Text.UTF8Encoding]::new($false))

Write-Host "4. Uploading OTA v$Version (code $nextCode, sha256 $sha)..." -ForegroundColor Cyan
scp -i $KeyPath -o StrictHostKeyChecking=no $zipPath "${ServerHost}:/home/opc/metube/server/ota_releases/bundle.zip.tmp"
scp -i $KeyPath -o StrictHostKeyChecking=no $manifestTmp "${ServerHost}:/home/opc/metube/server/ota_releases/manifest.json"
ssh -i $KeyPath -o StrictHostKeyChecking=no $ServerHost "mv /home/opc/metube/server/ota_releases/bundle.zip.tmp /home/opc/metube/server/ota_releases/bundle.zip"

Remove-Item $zipPath -Force
Remove-Item $manifestTmp -Force

Write-Host "Published OTA v$Version (ota_code=$nextCode) successfully!" -ForegroundColor Green


# MeTube 24/7 Server + Worldwide Cloudflare Tunnel Launcher
$ErrorActionPreference = "Continue"

Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host "       STARTING METUBE SERVER + WORLDWIDE CLOUDFLARE TUNNEL            " -ForegroundColor Cyan
Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Configure power settings so laptop does not sleep with lid closed
Write-Host "[*] Applying Windows 24/7 power settings..." -ForegroundColor Yellow
powercfg -change -standby-timeout-ac 0 | Out-Null
powercfg -setacvalueindex SCHEME_CURRENT 4f971e89-eebd-4455-a8de-9e59040e7347 5ca83367-6e45-459f-a27b-476b1d01c936 0 | Out-Null
powercfg -setdcvalueindex SCHEME_CURRENT 4f971e89-eebd-4455-a8de-9e59040e7347 5ca83367-6e45-459f-a27b-476b1d01c936 0 | Out-Null
powercfg -SetActive SCHEME_CURRENT | Out-Null
Write-Host "[OK] Laptop is configured to run 24/7 with lid closed!" -ForegroundColor Green

# 2. Get Local Wi-Fi IP
$localIp = (Get-NetIPConfiguration | Where-Object IPv4DefaultGateway | Select-Object -ExpandProperty IPv4Address).IPAddress
if (-not $localIp) { $localIp = "127.0.0.1" }

# 3. Ensure Python venv and requirements
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

if (-not (Test-Path "venv\Scripts\python.exe")) {
    Write-Host "[*] Setting up Python virtual environment..." -ForegroundColor Yellow
    python -m venv venv
    & "venv\Scripts\pip.exe" install --upgrade pip
    & "venv\Scripts\pip.exe" install -r requirements.txt
}

# 4. Start FastAPI server
Write-Host "[*] Starting FastAPI backend on port 8000..." -ForegroundColor Yellow
$fastApiProcess = Start-Process -FilePath "venv\Scripts\python.exe" -ArgumentList "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000" -NoNewWindow -PassThru

# 5. Start Cloudflare Tunnel
$cfExe = Join-Path $scriptDir "cloudflared.exe"
if (-not (Test-Path $cfExe)) {
    Write-Host "[*] Downloading Cloudflare Tunnel binary (first time only)..." -ForegroundColor Yellow
    Invoke-WebRequest -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" -OutFile $cfExe -UseBasicParsing
}

Write-Host "[*] Establishing Worldwide Cloudflare HTTPS Tunnel..." -ForegroundColor Yellow
$tunnelLog = Join-Path $scriptDir "tunnel.log"
if (Test-Path $tunnelLog) { Remove-Item $tunnelLog -Force }

$cfProcess = Start-Process -FilePath $cfExe -ArgumentList "tunnel", "--url", "http://127.0.0.1:8000" -NoNewWindow -PassThru -RedirectStandardError $tunnelLog

# Wait for tunnel URL
$publicUrl = ""
$attempts = 0
while ($attempts -lt 25 -and [string]::IsNullOrWhiteSpace($publicUrl)) {
    Start-Sleep -Seconds 1
    $attempts++
    if (Test-Path $tunnelLog) {
        $lines = Get-Content $tunnelLog
        foreach ($line in $lines) {
            if ($line -match "(https://[a-zA-Z0-9-]+\.trycloudflare\.com)") {
                $publicUrl = $Matches[1]
                break
            }
        }
    }
}

if ($publicUrl) {
    Set-Content -Path (Join-Path $scriptDir "public_url.txt") -Value $publicUrl
}

Write-Host ""
Write-Host "========================================================================" -ForegroundColor Green
Write-Host "                  METUBE SERVER IS ONLINE & LIVE!                      " -ForegroundColor Green
Write-Host "========================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  [1] HOME WI-FI URL:       http://${localIp}:8000" -ForegroundColor Cyan
Write-Host "      (Fastest - for any phone/PC on your home Wi-Fi)" -ForegroundColor Gray
Write-Host ""
if ($publicUrl) {
    Write-Host "  [2] WORLDWIDE PUBLIC URL: $publicUrl" -ForegroundColor Magenta
    Write-Host "      (Share this with ANYONE in the world on 4G, 5G, or any Wi-Fi!)" -ForegroundColor Gray
} else {
    Write-Host "  [2] WORLDWIDE PUBLIC URL: Generating in background... check tunnel.log" -ForegroundColor Yellow
}
Write-Host ""
Write-Host "------------------------------------------------------------------------" -ForegroundColor DarkCyan
Write-Host "  HOW OTHERS CAN USE YOUR APP:" -ForegroundColor White
Write-Host "  1. Share your MeTube.apk with friends, neighbors, or anyone." -ForegroundColor Gray
Write-Host "  2. Open MeTube app -> Settings (gear icon) -> Custom Backend Server URL." -ForegroundColor Gray
if ($publicUrl) {
    Write-Host "  3. Enter: $publicUrl" -ForegroundColor Yellow
} else {
    Write-Host "  3. Enter the Worldwide Public URL above" -ForegroundColor Yellow
}
Write-Host "  4. Tap 'Connect & Save'." -ForegroundColor Gray
Write-Host "------------------------------------------------------------------------" -ForegroundColor DarkCyan
Write-Host "  RUNNING 24/7:" -ForegroundColor White
Write-Host "  - Keep your laptop plugged into its charger." -ForegroundColor Gray
Write-Host "  - Close the lid! Screen turns off, but server stays online 24/7." -ForegroundColor Gray
Write-Host "========================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Server is running. Press CTRL+C or close this window to stop." -ForegroundColor White

try {
    Wait-Process -Id $fastApiProcess.Id
} finally {
    Stop-Process -Id $fastApiProcess.Id -Force -ErrorAction SilentlyContinue
    Stop-Process -Id $cfProcess.Id -Force -ErrorAction SilentlyContinue
}

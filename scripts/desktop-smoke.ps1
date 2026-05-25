# Проверка API перед сборкой десктопа (Windows, без bash).
param([string]$ApiUrl)

$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot

if (-not $ApiUrl) {
  $envFile = Join-Path $Repo 'desktop\.env'
  if (Test-Path $envFile) {
    $line = Get-Content $envFile | Where-Object { $_ -match '^VITE_API_URL=' } | Select-Object -First 1
    if ($line) { $ApiUrl = ($line -replace '^VITE_API_URL=', '').Trim().Trim('"').Trim("'") }
  }
}

$ApiUrl = $ApiUrl.TrimEnd('/')
if (-not $ApiUrl) {
  Write-Error 'Укажите URL: .\scripts\desktop-smoke.ps1 https://your-api.example.com'
}

Write-Host "API: $ApiUrl"

try {
  $health = Invoke-WebRequest -Uri "$ApiUrl/health" -UseBasicParsing -TimeoutSec 20
  if ($health.StatusCode -ne 200) { throw "HTTP $($health.StatusCode)" }
  Write-Host "OK   /health -> $($health.Content)"
} catch {
  Write-Error "FAIL /health -> $_"
}

foreach ($origin in @('tauri://localhost', 'https://tauri.localhost')) {
  try {
    $r = Invoke-WebRequest -Uri "$ApiUrl/auth/login" -Method Options -UseBasicParsing -TimeoutSec 20 `
      -Headers @{
        Origin = $origin
        'Access-Control-Request-Method' = 'POST'
        'Access-Control-Request-Headers' = 'content-type,authorization'
      }
    $code = [int]$r.StatusCode
    if ($code -eq 200 -or $code -eq 204) {
      Write-Host "OK   CORS preflight ($origin) -> $code"
    } else {
      Write-Warning "WARN CORS preflight ($origin) -> HTTP $code (добавьте origin в CORS_ORIGIN на сервере)"
    }
  } catch {
    if ($_.Exception.Response) {
      $code = [int]$_.Exception.Response.StatusCode
      if ($code -eq 200 -or $code -eq 204) {
        Write-Host "OK   CORS preflight ($origin) -> $code"
        continue
      }
      Write-Warning "WARN CORS preflight ($origin) -> HTTP $code"
    } else {
      Write-Warning "WARN CORS preflight ($origin) -> $_"
    }
  }
}

Write-Host 'Smoke OK — можно собирать desktop (.\scripts\desktop-build.ps1)'

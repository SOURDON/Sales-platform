# Сборка установщика Windows (NSIS .exe). Запускать в PowerShell на Windows.
#   cd Sales-platform
#   .\scripts\desktop-build.ps1
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot

if (-not (Test-Path "$Repo\desktop\.env")) {
  Copy-Item "$Repo\desktop\.env.example" "$Repo\desktop\.env"
  Write-Host 'Создан desktop\.env — укажите VITE_API_URL=URL_вашего_сервера перед прод-сборкой!'
}

$apiLine = Get-Content "$Repo\desktop\.env" | Where-Object { $_ -match '^VITE_API_URL=' } | Select-Object -First 1
if ($apiLine -match 'localhost' -and $env:DESKTOP_BUILD_SKIP_CONFIRM -ne '1') {
  Write-Warning "VITE_API_URL указывает на localhost. Для сотрудников нужен боевой URL в desktop\.env"
  $reply = Read-Host 'Продолжить? [y/N]'
  if ($reply -notmatch '^[Yy]$') { exit 0 }
}

if ($env:DESKTOP_BUILD_SKIP_SMOKE -ne '1') {
  & "$Repo\scripts\desktop-smoke.ps1"
}

foreach ($cmd in @('node', 'npm', 'cargo')) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    Write-Error "Не найден $cmd. Установите Node.js LTS и Rust: https://rustup.rs/"
  }
}

Push-Location "$Repo\frontend"
npm install
Pop-Location

Push-Location "$Repo\desktop"
if (-not (Test-Path 'src-tauri\icons\icon.ico')) {
  npm run icon
}
npm install
npm run build
Pop-Location

$nsisDir = "$Repo\desktop\src-tauri\target\release\bundle\nsis"
$exe = Get-ChildItem -Path $nsisDir -Filter '*setup.exe' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $exe) {
  Write-Error "Не найден setup.exe в $nsisDir"
}

$outDir = "$Repo\desktop\dist"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
Copy-Item $exe.FullName $outDir -Force
Write-Host "Готово: $outDir\$($exe.Name)"
Write-Host 'Инструкция для пользователей: docs\DESKTOP_USER_GUIDE.md'

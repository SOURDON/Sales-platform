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
if ($env:DESKTOP_BUILD_PROFILE -eq 'store-offline') {
  npm run build:store
} elseif ($env:DESKTOP_BUILD_PROFILE -eq 'director-offline') {
  if (-not (Test-Path 'src-tauri\icons-director\icon.ico')) {
    npm run icon:director
  }
  npm run build:director
} else {
  npm run build
}
Pop-Location

$bundleRoot = "$Repo\desktop\src-tauri\target\release\bundle"
$exe = Get-ChildItem -Path $bundleRoot -Filter '*setup.exe' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $exe) {
  Write-Host "Содержимое $bundleRoot :"
  if (Test-Path $bundleRoot) {
    Get-ChildItem -Path $bundleRoot -Recurse | Select-Object -First 40 FullName
  }
  Write-Error "Не найден *setup.exe под $bundleRoot"
}

$outDir = "$Repo\desktop\dist"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
Copy-Item $exe.FullName $outDir -Force
Write-Host "Готово: $outDir\$($exe.Name)"
Write-Host 'Инструкция для пользователей: docs\DESKTOP_USER_GUIDE.md'

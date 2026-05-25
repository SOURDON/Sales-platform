# Полная подготовка Windows для сборки десктопа Sales-platform.
# Запуск от администратора (правый клик PowerShell → «Запуск от имени администратора»):
#   Set-ExecutionPolicy -Scope Process Bypass -Force
#   cd $HOME\Projects\Sales-platform
#   .\scripts\windows-setup-all.ps1
#
# После успеха — обычный PowerShell (без админа):
#   .\scripts\desktop-build.ps1

$ErrorActionPreference = 'Stop'

function Test-Admin {
  $current = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($current)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-Admin)) {
  Write-Error @'
Запустите PowerShell ОТ ИМЕНИ АДМИНИСТРАТОРА:
  Win → «PowerShell» → правый клик → «Запуск от имени администратора»
  cd путь\к\Sales-platform
  Set-ExecutionPolicy -Scope Process Bypass -Force
  .\scripts\windows-setup-all.ps1
'@
}

if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
  Write-Error 'winget не найден. Обновите Windows 10/11 или установите App Installer из Microsoft Store.'
}

Write-Host '=== 1/5 Git ===' -ForegroundColor Cyan
winget install -e --id Git.Git --accept-package-agreements --accept-source-agreements --disable-interactivity 2>$null
if ($LASTEXITCODE -gt 1) { $LASTEXITCODE = 0 }

Write-Host '=== 2/5 Node.js LTS ===' -ForegroundColor Cyan
winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements --disable-interactivity 2>$null
if ($LASTEXITCODE -gt 1) { $LASTEXITCODE = 0 }

Write-Host '=== 3/5 Visual Studio Build Tools (C++) — 10–30 мин, не отменяйте ===' -ForegroundColor Cyan
$vsArgs = @(
  '--quiet', '--wait', '--norestart',
  '--add', 'Microsoft.VisualStudio.Workload.VCTools',
  '--includeRecommended'
) -join ' '
winget install -e --id Microsoft.VisualStudio.2022.BuildTools `
  --override $vsArgs `
  --accept-package-agreements --accept-source-agreements --disable-interactivity
if ($LASTEXITCODE -gt 1) {
  Write-Warning "winget VS exit $LASTEXITCODE — если сборка позже упадёт, установите C++ вручную из visualstudio.microsoft.com/visual-cpp-build-tools/"
}

Write-Host '=== 4/5 Rust (rustup) ===' -ForegroundColor Cyan
winget install -e --id Rustlang.Rustup --accept-package-agreements --accept-source-agreements --disable-interactivity 2>$null
if ($LASTEXITCODE -gt 1) { $LASTEXITCODE = 0 }

$env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path', 'User')

Write-Host '=== 5/5 Проверка ===' -ForegroundColor Cyan
foreach ($cmd in @('git', 'node', 'npm', 'rustc', 'cargo')) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    Write-Warning "После перезагрузки проверьте: $cmd --version"
  } else {
    & $cmd --version
  }
}

$Repo = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $Repo 'desktop\.env'
if (-not (Test-Path $envFile)) {
  Copy-Item (Join-Path $Repo 'desktop\.env.example') $envFile
  Add-Content $envFile "`nVITE_API_URL=https://sales-platform-1.onrender.com"
  Write-Host "Создан $envFile"
}

Write-Host @'

Готово. ПЕРЕЗАГРУЗИТЕ ПК, затем в обычном PowerShell:
  cd путь\к\Sales-platform
  git pull
  .\scripts\desktop-build.ps1

Или откройте папку в Cursor и напишите агенту: «запусти desktop-build.ps1».
'@ -ForegroundColor Green

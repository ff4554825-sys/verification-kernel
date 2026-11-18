#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Enable WSL2 and install Ubuntu for the verification-kernel test-patch runtime.

.DESCRIPTION
  Run once elevated, reboot when asked, then run again with -PostReboot.
  This script uses only the standard Windows DISM/WSL mechanisms. It does not
  bypass UAC and does not change the current DSH process token.

  After -PostReboot, launch Ubuntu once to create a Linux user, then either:
  - run test commands inside WSL directly, or
  - install Docker Desktop with: .\enable-wsl.ps1 -InstallDocker
#>
[CmdletBinding()]
param(
  [switch]$PostReboot,
  [switch]$InstallDocker
)

$ErrorActionPreference = 'Stop'
$log = Join-Path $PSScriptRoot 'enable-wsl.log'
Start-Transcript -Path $log -Append | Out-Null

function Invoke-DismFeature([string]$Name) {
  Write-Host "Enabling feature: $Name"
  & dism.exe /online /enable-feature /featurename:$Name /all /norestart
  $code = $LASTEXITCODE
  if ($code -eq 3010) {
    $script:NeedsReboot = $true
    Write-Host "  $Name enabled; reboot required (3010)."
    return
  }
  if ($code -ne 0) { throw "dism failed for $Name with exit code $code" }
}

$NeedsReboot = $false

if (-not $PostReboot) {
  Invoke-DismFeature 'Microsoft-Windows-Subsystem-Linux'
  Invoke-DismFeature 'VirtualMachinePlatform'
  if ($NeedsReboot) {
    Write-Host ''
    Write-Host 'Reboot Windows, then run this script again with -PostReboot:' -ForegroundColor Yellow
    Write-Host "  powershell -ExecutionPolicy Bypass -File `"$PSCommandPath`" -PostReboot"
  } else {
    Write-Host 'Features were already enabled. Run with -PostReboot to install Ubuntu.'
  }
  Stop-Transcript | Out-Null
  return
}

Write-Host 'Updating WSL...'
& wsl.exe --update
if ($LASTEXITCODE -ne 0) { Write-Warning "wsl --update exited $LASTEXITCODE; continuing." }

Write-Host 'Setting default WSL version to 2...'
& wsl.exe --set-default-version 2
if ($LASTEXITCODE -ne 0) { Write-Warning "wsl --set-default-version exited $LASTEXITCODE; continuing." }

Write-Host 'Installing Ubuntu (no auto-launch)...'
& wsl.exe --install -d Ubuntu --no-launch
$wslCode = $LASTEXITCODE
if ($wslCode -eq 3010) {
  Write-Host 'A reboot is required to finish WSL setup.' -ForegroundColor Yellow
} elseif ($wslCode -ne 0) {
  throw "wsl --install -d Ubuntu --no-launch failed with exit code $wslCode"
}

Write-Host ''
Write-Host 'Launch Ubuntu once to create your Linux user:' -ForegroundColor Yellow
Write-Host '  wsl -d Ubuntu'
Write-Host 'Then verify from this Windows session:'
Write-Host '  wsl -d Ubuntu -- bash -lc "node --version || true; git --version || true"'

if ($InstallDocker) {
  Write-Host 'Installing Docker Desktop via winget (large download)...'
  & winget.exe install --id Docker.DockerDesktop -e --accept-source-agreements --accept-package-agreements
  if ($LASTEXITCODE -ne 0) { throw "Docker Desktop install exited $LASTEXITCODE" }
  Write-Host 'Docker Desktop installed. Start it once and wait for the engine.'
}

Stop-Transcript | Out-Null

$ErrorActionPreference = 'Continue'
Set-Location (Split-Path -Parent $PSScriptRoot)
$status = 0
$signArgs = @()
if ($env:VERIFICATION_SIGNING_KEY) { $signArgs = @('--sign-key', $env:VERIFICATION_SIGNING_KEY) }
node bin/verify.js --plan ci/plan.json --cwd . @signArgs
if ($LASTEXITCODE -ne 0) { $status = $LASTEXITCODE }
node bin/report.js --dir .dsh/verification
if ($env:VERIFICATION_PUBLIC_KEY) {
  node bin/verdict-verify.js --verdict .dsh/verification/latest.json --pub $env:VERIFICATION_PUBLIC_KEY
  if ($LASTEXITCODE -ne 0) { $status = 1 }
}
exit $status

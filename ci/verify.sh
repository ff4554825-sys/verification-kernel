#!/usr/bin/env bash
set -u
cd "$(dirname "$0")/.."
status=0
sign_args=()
if [ -n "${VERIFICATION_SIGNING_KEY:-}" ]; then
  sign_args=(--sign-key "$VERIFICATION_SIGNING_KEY")
fi
node bin/verify.js --plan ci/plan.json --cwd . "${sign_args[@]}" || status=$?
node bin/report.js --dir .dsh/verification || true
if [ -n "${VERIFICATION_PUBLIC_KEY:-}" ]; then
  node bin/verdict-verify.js --verdict .dsh/verification/latest.json --pub "$VERIFICATION_PUBLIC_KEY" || status=1
fi
exit "$status"

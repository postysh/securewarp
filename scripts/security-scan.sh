#!/usr/bin/env bash
#
# SecureWarp Security Scan
#
# Runs a battery of security checks before code ships. Two modes:
#
#   ./scripts/security-scan.sh quick   — pre-commit: fast local checks (~15s)
#   ./scripts/security-scan.sh full    — pre-push: everything incl. DAST (~3 min)
#   ./scripts/security-scan.sh         — defaults to "quick"
#
# Exit code 0 = all clear. Non-zero = at least one check failed.
# Individual check failures are logged but don't stop subsequent checks
# so you see the full picture in one run.
#
# Prerequisites (brew install):
#   gitleaks semgrep nuclei testssl trivy
#
# ─────────────────────────────────────────────────────────────────────

set -euo pipefail

MODE="${1:-quick}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

FAILURES=0
PASS=0

run_check() {
  local name="$1"
  shift
  printf "${CYAN}${BOLD}▸ %-35s${NC}" "$name"
  if output=$("$@" 2>&1); then
    printf "${GREEN}PASS${NC}\n"
    PASS=$((PASS + 1))
  else
    printf "${RED}FAIL${NC}\n"
    echo "$output" | head -20
    FAILURES=$((FAILURES + 1))
  fi
}

header() {
  echo ""
  printf "${BOLD}━━━ %s ━━━${NC}\n" "$1"
  echo ""
}

# ─── Always run (quick + full) ──────────────────────────────────────

header "DEPENDENCY VULNERABILITIES"

run_check "npm audit" \
  npm audit --audit-level=high

run_check "Trivy filesystem scan" \
  trivy fs --severity HIGH,CRITICAL --exit-code 1 --quiet .

header "SECRET SCANNING"

run_check "Gitleaks (git history)" \
  gitleaks detect -s . --no-banner --exit-code 1

run_check "Gitleaks (staged files)" \
  gitleaks protect --staged --no-banner --exit-code 1

header "STATIC ANALYSIS"

run_check "Semgrep (security rules)" \
  semgrep scan --config auto --severity ERROR --severity WARNING \
    --quiet --error src/

run_check "TypeScript type check" \
  npx tsc --noEmit --pretty false

header "BUILD VERIFICATION"

run_check "Next.js build" \
  npm run build

header "TESTS"

run_check "Vitest" \
  npm test -- --run

# ─── Full mode only (pre-push / manual) ─────────────────────────────

if [[ "$MODE" == "full" ]]; then

  header "DAST (live scan against production)"

  PROD_URL="${SCAN_URL:-https://securewarp.com}"

  run_check "Nuclei (OWASP + CVE + misconfig)" \
    nuclei -u "$PROD_URL" -as \
      -severity medium,high,critical \
      -silent -no-color

  header "HTTP SECURITY HEADERS"

  # Check each critical header is present
  HEADERS=$(curl -sI "$PROD_URL" 2>/dev/null)

  for h in \
    "strict-transport-security" \
    "content-security-policy" \
    "x-content-type-options" \
    "x-frame-options" \
    "referrer-policy" \
    "permissions-policy" \
    "cross-origin-opener-policy" \
    "cross-origin-resource-policy"; do
    run_check "Header: $h" \
      bash -c "echo '$HEADERS' | grep -qi '$h'"
  done

  header "TLS / SSL"

  run_check "testssl.sh (grade A or above)" \
    bash -c "testssl.sh --quiet --severity HIGH '$PROD_URL' 2>&1 | grep -q 'Overall Grade.*A'"

fi

# ─── Summary ────────────────────────────────────────────────────────

header "SUMMARY"

TOTAL=$((PASS + FAILURES))
if [[ $FAILURES -eq 0 ]]; then
  printf "${GREEN}${BOLD}All %d checks passed.${NC}\n\n" "$TOTAL"
  exit 0
else
  printf "${RED}${BOLD}%d of %d checks failed.${NC}\n\n" "$FAILURES" "$TOTAL"
  exit 1
fi

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

# Verifies every installed package has a valid npm-registry signature.
# Catches tampered tarballs that slip past advisory-based npm audit.
run_check "npm package signatures" \
  npm audit signatures

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

  header "SBOM"

  # Generate a CycloneDX SBOM for audit / release archival. The CI
  # workflow also produces one on every main push as an artifact.
  # --ignore-npm-errors: cyclonedx runs `npm ls` internally and aborts
  # on "extraneous"/"invalid" warnings that legitimately-installed
  # optional deps (platform-specific binaries, etc.) trigger. Those
  # deps still belong in the SBOM; we just don't want npm-ls pedantry
  # to fail the whole generation.
  run_check "CycloneDX SBOM generation" \
    bash -c "npx --yes @cyclonedx/cyclonedx-npm --ignore-npm-errors --output-format JSON --output-file '$REPO_ROOT/sbom.json' 2>&1"

  header "DAST (live scan against production)"

  PROD_URL="${SCAN_URL:-https://securewarp.com}"

  run_check "Nuclei (OWASP + CVE + misconfig)" \
    nuclei -u "$PROD_URL" -as \
      -severity medium,high,critical \
      -silent -no-color

  # SecureWarp-specific templates: route-level invariants that generic
  # Nuclei rules can't know about (anonymous link 404-collapse, POST-only
  # method restrictions, auth gates on state-change endpoints, etc.).
  # Templates report FINDINGS — a clean run is silent, matches mean a
  # regression was detected. Nuclei has no native fail-on-match flag,
  # so we invert: any stdout output = match = fail.
  run_check "Nuclei (SecureWarp custom templates)" \
    bash -c "out=\$(nuclei -u '$PROD_URL' -t '$REPO_ROOT/security/nuclei/' -silent -no-color 2>&1); if [ -n \"\$out\" ]; then echo \"\$out\"; exit 1; fi"

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

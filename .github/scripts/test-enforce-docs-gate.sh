#!/usr/bin/env bash
# .github/scripts/test-enforce-docs-gate.sh — MNE-1064 self-test.
#
# Proves enforce-docs-gate.sh's contract with fixed fixtures, no network / no
# GATE_ACTIVE / no App key required. Runs on every PR via the
# `docs-gate-enforcement-selftest` job in verify-docs-gate.yml.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENFORCE="${SCRIPT_DIR}/enforce-docs-gate.sh"
FIXTURES="${SCRIPT_DIR}/fixtures"

pass=0
fail=0

# args: <name> <expected_exit> <report> <thresholds>
check() {
  local name="$1" expected="$2" report="$3" thresholds="$4"
  "$ENFORCE" "$report" "$thresholds" >/tmp/enforce-out.$$ 2>&1
  local actual=$?
  if [[ "$actual" -eq "$expected" ]]; then
    echo "ok   - $name (exit $actual, expected $expected)"
    pass=$((pass + 1))
  else
    echo "FAIL - $name (exit $actual, expected $expected)"
    sed 's/^/       | /' /tmp/enforce-out.$$
    fail=$((fail + 1))
  fi
  rm -f /tmp/enforce-out.$$
}

# 1. Synthetic link failure, links flipped to blocking (test manifest) -> must fail the gate.
check "synthetic link failure fails the PR when links is blocking" \
  1 \
  "${FIXTURES}/report-link-failure.json" \
  "${FIXTURES}/test-thresholds.json"

# 2. Synthetic api-examples failure, api-examples stays advisory -> must NOT fail the gate.
check "api-examples (live-prod) failure does not fail the PR" \
  0 \
  "${FIXTURES}/report-api-examples-failure.json" \
  "${FIXTURES}/test-thresholds.json"

# 3. Real, currently-committed thresholds.json against today's real observed
#    cli/links false-positives -> must NOT fail (only sdk is blocking, and
#    it's clean in this fixture) -- proves the real policy doesn't red-wall
#    the known, tracked backlog.
check "real thresholds.json does not red-wall today's tracked cli/links backlog" \
  0 \
  "${FIXTURES}/report-real-current-state.json" \
  "${SCRIPT_DIR}/../docs-gate-thresholds.json"

# 4. Real, currently-committed thresholds.json with sdk (the one flipped
#    layer) regressed -> must fail -- proves new drift in a now-clean layer
#    red-walls.
check "sdk regression red-walls under the real thresholds.json" \
  1 \
  "${FIXTURES}/report-sdk-regression.json" \
  "${SCRIPT_DIR}/../docs-gate-thresholds.json"

echo ""
echo "enforce-docs-gate self-test: ${pass} passed, ${fail} failed"
[[ "$fail" -eq 0 ]]

#!/usr/bin/env bash
# .github/scripts/enforce-docs-gate.sh — MNE-1064 per-layer enforcement.
#
# Reads a mnemom-test SurfaceReport (report.json) and this repo's committed
# threshold manifest (docs-gate-thresholds.json), and fails (exit 1) iff any
# layer marked "blocking" in the manifest has (failed + errors) > its budget
# in the report. Layers marked "advisory" never fail this check, no matter
# what the report says -- that's the whole point of the split (see the
# workflow header for the two-flip plan).
#
# A layer present in the manifest but absent from the report (e.g. a
# --layers= subset run) is skipped with a warning, not a failure -- this
# script only enforces layers it actually has data for.
#
# Usage: enforce-docs-gate.sh <report.json> <thresholds.json>
# Exit:  0 — no blocking-layer breach (or nothing to enforce)
#        1 — at least one blocking layer exceeded its budget
#        2 — usage / infra error (bad args, unparseable JSON, missing jq)
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: enforce-docs-gate.sh <report.json> <thresholds.json>" >&2
  exit 2
fi

REPORT="$1"
THRESHOLDS="$2"

for f in "$REPORT" "$THRESHOLDS"; do
  if [[ ! -s "$f" ]]; then
    echo "[enforce-docs-gate] ERROR: missing or empty file: $f" >&2
    exit 2
  fi
done

if ! command -v jq >/dev/null 2>&1; then
  echo "[enforce-docs-gate] ERROR: jq is required" >&2
  exit 2
fi

breach=0

# One "layer<TAB>mode<TAB>budget" row per manifest entry (budget defaults to 0).
while IFS=$'\t' read -r layer mode budget; do
  [[ -z "$layer" ]] && continue
  if [[ "$mode" != "blocking" ]]; then
    continue
  fi

  axis_json="$(jq -c --arg axis "$layer" '.axes[] | select(.axis == $axis)' "$REPORT")"
  if [[ -z "$axis_json" ]]; then
    echo "[enforce-docs-gate] WARN: blocking layer '$layer' not present in report — skipping (not this run's scope)" >&2
    continue
  fi

  failed="$(jq -r '.failed // 0' <<<"$axis_json")"
  errors="$(jq -r '.errors // 0' <<<"$axis_json")"
  total_bad=$((failed + errors))

  if (( total_bad > budget )); then
    echo "[enforce-docs-gate] ❌ BLOCKING layer '$layer': $failed failed + $errors errors = $total_bad > budget $budget" >&2
    jq -r --arg axis "$layer" '
      .axes[] | select(.axis == $axis) | .details[]?
      | select(.severity == "fail" or .severity == "error")
      | "    - " + .description + " — " + .message
    ' "$REPORT" >&2 || true
    breach=1
  else
    echo "[enforce-docs-gate] ✓ blocking layer '$layer': $failed failed + $errors errors = $total_bad <= budget $budget" >&2
  fi
done < <(jq -r '.layers | to_entries[] | [.key, .value.mode, (.value.budget // 0)] | @tsv' "$THRESHOLDS")

if [[ "$breach" -eq 1 ]]; then
  echo "[enforce-docs-gate] one or more blocking layers breached their budget — failing the gate." >&2
  exit 1
fi

echo "[enforce-docs-gate] all blocking layers within budget." >&2
exit 0

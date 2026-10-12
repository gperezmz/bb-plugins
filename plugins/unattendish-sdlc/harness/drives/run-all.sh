#!/usr/bin/env bash
# Runs every drive against the running harness, one after the other, and
# prints each one's result and wall time. Exits non-zero when any fails.
#
#   harness/drives/run-all.sh
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
results=()
failed=0
for d in register wake echo turn-end no-manager credentials trackers restart dashboard; do
  echo "== $d"
  out=$("$here/$d.sh" 2>&1)
  status=$?
  echo "$out"
  line=$(grep -E '^(PASS|FAIL) ' <<< "$out" | tail -1)
  [[ -n $line ]] || line="FAIL $d (no result, exit $status)"
  results+=("$line")
  [[ $status -eq 0 ]] || failed=$((failed + 1))
done
echo
echo "Results (each must finish in under 120 s of wall time):"
printf '  %s\n' "${results[@]}"
exit $((failed > 0))

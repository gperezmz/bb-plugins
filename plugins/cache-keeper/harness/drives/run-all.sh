#!/usr/bin/env bash
# Runs every drive against the running harness, one after the other, the
# reinstall reset last since it switches everything off, and prints each
# one's result and wall time, then checks that no archived drive thread got
# a message afterwards. Exits non-zero when any fails.
#
#   harness/drives/run-all.sh
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
results=()
failed=0
for d in compaction tree-keep-warm cost-stop check-in skip-undo reinstall archived-quiet; do
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

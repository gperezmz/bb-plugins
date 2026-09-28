#!/usr/bin/env bash
# After the other drives: no thread a drive made and archived got a message
# from Cache Keeper (a keep-warm, a check-in or a /compact) after bb recorded
# it archived, however the later drives moved the clock. Checked from bb's
# event history of each thread.
source "$(dirname "$0")/lib.sh"
drive archived-quiet
n=0
while read -r d t; do
  [[ $d == archived-quiet ]] && continue
  archived=$(bb thread show "$t" --json | jq '.thread.archivedAt')
  if [[ $archived == null ]]; then
    say "FAILED: $t ($d) is not archived"
    failures=$((failures + 1))
    continue
  fi
  late=$(requests "$t" | jq -s --argjson a "$archived" --arg re "$KEEP_WARM|$COMPACT|$CHECK_IN" '[.[] | select(.at > $a and (.text | test($re)))] | length')
  check "$t ($d): nothing sent after it was archived" eq "$late" 0
  n=$((n + 1))
done < "$threads_file"
check "checked every drive's threads ($n)" within "$n" 1 1000
finish

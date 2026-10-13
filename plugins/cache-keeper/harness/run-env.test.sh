#!/usr/bin/env bash
# Checks run-env.sh's leak check against processes it starts itself, with no
# bb: a caller's variable, same name and value, outside both lists is a leak;
# the same name with another value, a name on run_env_set_by_run or one on the
# passed list is none; the planted variable is one whatever its value; and the
# report names variables and never prints a value. Prints PASS or FAIL per case
# and exits non-zero on any FAIL.
#
#   plugins/cache-keeper/harness/run-env.test.sh
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
dir=$(mktemp -d)
trap 'kill "${pids[@]}" 2> /dev/null; rm -rf "$dir"' EXIT
pids=()
failed=0
value=run-env-test-value-$RANDOM$RANDOM
export RUN_ENV_TEST_SECRET=$value DISABLE_AUTOUPDATER=1 LANG=${LANG:-C.UTF-8}
# shellcheck source=run-env.sh
source "$here/run-env.sh"
run_env_record "$dir/caller-env"
plant=$(awk '$1 == "plant" { print $2 }' "$dir/caller-env")

# A process holding exactly the given environment; prints its PID.
holding() {
  env -i "$@" sleep 60 &
  pids+=($!)
  sleep 0.1
}

# case <name> <expect leak|none> <leaked name or -> <env>...
case_() {
  local name=$1 expect=$2 leaked=$3 out status
  shift 3
  holding "$@"
  out=$(run_env_leaks "$dir/caller-env" "${pids[-1]}")
  status=$?
  if [[ $out == *"$value"* ]]; then
    echo "FAIL $name: the report printed a value"
    failed=1
  elif [[ $expect == leak && ($status -ne 1 || $out != *"leak: $leaked,"* || $out != *"$run_env_file"*) ]]; then
    echo "FAIL $name: expected a leak of $leaked, naming where the list is kept; got exit $status"
    failed=1
  elif [[ $expect == none && ($status -ne 0 || -n $out) ]]; then
    echo "FAIL $name: expected no leak; got exit $status"
    failed=1
  else
    echo "PASS $name"
  fi
}

case_ "a caller's variable outside both lists is a leak" leak RUN_ENV_TEST_SECRET "RUN_ENV_TEST_SECRET=$value"
case_ "the same name with another value is none" none - RUN_ENV_TEST_SECRET=other
case_ "a name the run sets itself is none" none - DISABLE_AUTOUPDATER=1
case_ "a name on the passed list is none" none - "LANG=$LANG"
case_ "an empty environment is none" none -
case_ "the planted variable is a leak whatever its value" leak "$plant" "$plant=anything"
if grep -qF -- "$value" "$dir/caller-env"; then
  echo "FAIL the record holds a value"
  failed=1
else
  echo "PASS the record holds no value"
fi
exit $failed

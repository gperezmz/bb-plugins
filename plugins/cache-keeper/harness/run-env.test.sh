#!/usr/bin/env bash
# Checks run-env.sh against processes it starts itself, with no bb: a caller's
# variable, same name and value, outside both lists is a leak; the same name
# with another value, a name on run_env_set_by_run or one on the passed list is
# none; the planted variable is one whatever its value; the report names
# variables and never prints a value; run_env keeps a run off the system
# bashrc, the D-Bus session bus and XDG_RUNTIME_DIR, and a bash started with it
# holds no leak; a shell sourcing run_env_script stops exporting what is not on
# the list; run_env_start_check fails on a leak and on a gh that finds a
# token; run_env_default_branch names the caller's init.defaultBranch, else the
# branch git itself gives a new repository, ignores the repository the caller
# stands in and fails on an empty setting. Prints PASS or FAIL per case and
# exits non-zero on any FAIL.
#
#   plugins/cache-keeper/harness/run-env.test.sh
# shellcheck disable=SC2016,SC2329 # the bash -c scripts expand their own arguments; check calls the helpers
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
dir=$(mktemp -d)
trap 'kill "${pids[@]}" 2> /dev/null; rm -rf "$dir"' EXIT
pids=()
failed=0
value=run-env-test-value-$RANDOM$RANDOM
export RUN_ENV_TEST_SECRET=$value DISABLE_AUTOUPDATER=1 LANG=${LANG:-C.UTF-8} XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR:-/run/user/$(id -u)}
# shellcheck source-path=SCRIPTDIR source=run-env.sh
source "$here/run-env.sh"
run_env_record "$dir/caller-env"
plant=$(awk '$1 == "plant" { print $2 }' "$dir/caller-env")

# A process holding exactly the given environment; appends its PID to pids.
holding() {
  env -i "$@" sleep 60 &
  pids+=($!)
  sleep 0.1
}

# case_ <name> <expect leak|none> <leaked name or -> <env>...
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

# check <name> <command>...: PASS when the command succeeds.
check() {
  local name=$1
  shift
  if "$@"; then echo "PASS $name"; else echo "FAIL $name"; failed=1; fi
}
holds() { [[ " ${run_env[*]} " == *" $1 "* ]]; }
lacks_name() { [[ " ${run_env[*]} " != *" $1="* ]]; }
check "run_env skips the system bashrc" holds NOSYSBASHRC=1
check "run_env keeps a run off the D-Bus session bus" holds DBUS_SESSION_BUS_ADDRESS=disabled:
check "run_env passes no XDG_RUNTIME_DIR" lacks_name XDG_RUNTIME_DIR

# A bash started with run_env, reading the system bashrc where it honours
# NOSYSBASHRC as NixOS's does, and the process it then starts.
if grep -qs NOSYSBASHRC /etc/bashrc; then
  env -i "${run_env[@]}" bash -c '. /etc/bashrc; exec sleep 60' &
else
  env -i "${run_env[@]}" bash -c 'exec sleep 60' &
fi
pids+=($!)
sleep 0.3
check "a bash started with run_env holds no leak" run_env_leaks "$dir/caller-env" "${pids[-1]}"

# A shell sourcing run_env_script exports none of what is not on the list.
run_env_script > "$dir/env.sh"
check "a shell sourcing run_env_script stops exporting the caller's variables" \
  bash -c 'source "$1"; ! env | grep -q "^RUN_ENV_TEST_SECRET="' _ "$dir/env.sh"

# run_env_start_check, in a subshell since it exits: <command> stands in for
# the harness's env -i prefix, `false` a gh that finds no token, `true` one
# that finds one.
holding
clean=${pids[-1]}
holding "RUN_ENV_TEST_SECRET=$value"
leaking=${pids[-1]}
check "run_env_start_check passes a run with no leak" \
  bash -c 'source "$1"; run_env_start_check test "$2" false -- "$3"' _ "$here/run-env.sh" "$dir/caller-env" "$clean"
out=$(bash -c 'source "$1"; run_env_start_check test "$2" false -- "$3"' _ "$here/run-env.sh" "$dir/caller-env" "$leaking" 2>&1) && status=0 || status=$?
check "run_env_start_check fails on a leak, each line headed by the script, naming the list" \
  bash -c '[[ $1 -eq 1 && $2 == "test: leak: RUN_ENV_TEST_SECRET,"* && $2 == *"test: a run passes only"* && $2 != *"$3"* ]]' _ "$status" "$out" "$value"
if command -v gh > /dev/null; then
  out=$(bash -c 'source "$1"; run_env_start_check test "$2" true -- "$3"' _ "$here/run-env.sh" "$dir/caller-env" "$clean" 2>&1) && status=0 || status=$?
  check "run_env_start_check fails when gh finds a token, naming the list" \
    bash -c '[[ $1 -eq 1 && $2 == *"finds a GitHub token"* && $2 == *"a run passes only"* ]]' _ "$status" "$out"
else
  echo "SKIP run_env_start_check on a gh that finds a token: no gh on PATH"
fi

# run_env_default_branch, with git's own configuration reduced to what a case
# sets, from a directory inside a repository whose config names another branch.
git_home=$dir/git-home
mkdir -p "$git_home" "$dir/stood-in"
git -C "$dir/stood-in" init -q
git -C "$dir/stood-in" config init.defaultBranch from-the-repository
caller_branch() {
  (cd "$dir/stood-in" && env HOME="$git_home" GIT_CONFIG_GLOBAL="$git_home/gitconfig" GIT_CONFIG_SYSTEM=/dev/null XDG_CONFIG_HOME="$git_home" \
    bash -c 'source "$1"; run_env_default_branch' _ "$here/run-env.sh" 2> /dev/null)
}
git -C "$git_home" config --file "$git_home/gitconfig" init.defaultBranch trunk
check "run_env_default_branch names the caller's init.defaultBranch, not the repository's" \
  bash -c '[[ $1 == trunk ]]' _ "$(caller_branch)"
: > "$git_home/gitconfig"
fresh=$(env HOME="$git_home" GIT_CONFIG_GLOBAL="$git_home/gitconfig" GIT_CONFIG_SYSTEM=/dev/null XDG_CONFIG_HOME="$git_home" \
  bash -c 'git init -q "$1" && git -C "$1" symbolic-ref --short HEAD' _ "$dir/fresh")
check "run_env_default_branch names git's own default with no setting, ignoring the repository's" \
  bash -c '[[ -n $1 && $1 != from-the-repository && $1 == $2 ]]' _ "$(caller_branch)" "$fresh"
git -C "$git_home" config --file "$git_home/gitconfig" init.defaultBranch ""
check "run_env_default_branch fails on an empty init.defaultBranch" \
  bash -c '! caller=$(cd "$2" && env HOME="$3" GIT_CONFIG_GLOBAL="$3/gitconfig" GIT_CONFIG_SYSTEM=/dev/null XDG_CONFIG_HOME="$3" bash -c "source \"\$1\"; run_env_default_branch" _ "$1" 2> /dev/null)' _ "$here/run-env.sh" "$dir/stood-in" "$git_home"
exit $failed

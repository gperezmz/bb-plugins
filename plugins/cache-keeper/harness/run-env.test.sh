#!/usr/bin/env bash
# Checks run-env.sh against processes it starts itself, with no bb: a caller's
# variable, same name and value, outside both lists is a leak; the same name
# with another value, a name on run_env_set_by_run or one on the passed list is
# none; the planted variable is one whatever its value; the report names
# variables and never prints a value; run_env keeps a run off the system
# bashrc, the D-Bus session bus and XDG_RUNTIME_DIR, and a bash started with it
# holds no leak; the passed list, run_env_set_by_run and every name run-env.sh
# adds to run_env outside the passed list hold no refused name, a credential or
# a way to one, nor any name containing TOKEN, SECRET, PASS, KEY, AUTH or
# CREDENTIAL in any letter case unless the test excepts it with why, and the
# failure names each such name and where it was found, never a value; a shell
# sourcing run_env_script stops exporting what is not on the list, and the
# functions the shell exported before sourcing it;
# run_env_start_check fails on a leak and on a gh that finds a
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

# A process holding exactly the given environment; appends its PID to pids. env
# execs sleep at once, but until it has, the process still holds the test's own
# environment, so wait for the exec, bounded at about 5 seconds.
holding() {
  local pid
  env -i "$@" sleep 60 &
  pid=$!
  pids+=("$pid")
  for _ in $(seq 500); do
    [[ $(cat "/proc/$pid/comm" 2> /dev/null) == sleep ]] && break
    sleep 0.01
  done
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

# Refused names: what the passed list, run_env_set_by_run and run-env.sh's own
# additions to run_env never hold, since a leak check cannot see a credential
# its own lists let through. A run reaches a credential by its value or by a
# variable that points at where one is kept. The test reads names alone and
# prints no value.
# A credential under a name that neither this list nor a pattern covers
# (AWS_PROFILE, NETRC, DATABASE_URL) still passes: add the name here. The awk
# below runs under mawk too, which is ubuntu-latest's awk.
declare -A refused=(
  [GH_TOKEN]="gh's token, which bb would hand every thread of the throwaway bb"
  [GITHUB_TOKEN]="a GitHub token, which gh and git read"
  [GITLAB_TOKEN]="a GitLab token, which glab and git read"
  [HOME]="points gh at the caller's hosts.yml and git at the caller's configuration"
  [XDG_RUNTIME_DIR]="points at the caller's D-Bus session bus and its keyring"
  [XDG_CONFIG_HOME]="points gh, git and Claude Code at the caller's configuration"
  [GH_CONFIG_DIR]="points gh at the caller's hosts.yml"
  [SSH_AUTH_SOCK]="points at the caller's SSH agent"
  [DBUS_SESSION_BUS_ADDRESS]="points at the caller's D-Bus session bus and its keyring; run_env holds it once, as DBUS_SESSION_BUS_ADDRESS=disabled:, since env -i keeps the last value it is given for a name"
  [BB_SERVER_URL]="points a run's bb CLI at the caller's own bb, not the throwaway"
  [BB_DATA_DIR]="points a run's bb at the caller's bb data, which holds their credentials"
  [BB_HOST_DAEMON_PORT]="points a run's bb at the caller's host daemon, not the throwaway's"
  [CLAUDE_CONFIG_DIR]="points Claude Code at the caller's login"
  [GNUPGHOME]="points gpg at the caller's keys"
  [KRB5CCNAME]="points at the caller's Kerberos ticket cache"
  [KUBECONFIG]="points kubectl at the caller's clusters and their credentials"
  [DOCKER_CONFIG]="points docker at the caller's registry logins"
  [NPM_CONFIG_USERCONFIG]="points npm at the caller's .npmrc, which holds registry tokens"
  [GIT_CONFIG_GLOBAL]="points git at the caller's configuration, credential helpers included"
)
# Case-insensitive substrings that mark a name as a credential's, since npm
# reads its token from lowercase npm_config_* variables.
patterns=(TOKEN SECRET PASS KEY AUTH CREDENTIAL)
# Names that match a pattern and have to be there, each with why. An exception
# exempts a name from the patterns only; a refused name fails whether or not
# it is listed here.
declare -A exempt=(
  [GIT_AUTHOR_NAME]="the harness names the drives' commits' author, and AUTH matches inside AUTHOR"
  [GIT_AUTHOR_EMAIL]="likewise"
)

# refusal_why <name>: prints why <name> is refused and returns 0, else returns 1.
refusal_why() {
  local name=$1 upper=${1^^} pattern
  if [[ -n ${refused[$name]+x} ]]; then
    echo "${refused[$name]}"
    return 0
  fi
  [[ -n ${exempt[$name]+x} ]] && return 1
  for pattern in "${patterns[@]}"; do
    if [[ $upper == *"$pattern"* ]]; then
      echo "its name contains $pattern, which marks a credential"
      return 0
    fi
  done
  return 1
}

# refused_among <place> <name>...: one line per refused name, naming where it
# was found and why it is refused.
refused_among() {
  local place=$1 name why
  shift
  for name in "$@"; do
    if why=$(refusal_why "$name"); then echo "$place: $name is refused: $why"; fi
  done
}

# The one entry of run_env that may name DBUS_SESSION_BUS_ADDRESS, once.
dbus_entry=DBUS_SESSION_BUS_ADDRESS=disabled:

# refused_entries <place>: reads, a line each, the labels of entries added to
# run_env outside the passed list: a name, the exact DBUS_SESSION_BUS_ADDRESS
# entry, or ? for one whose name could not be read. Prints a line per refused
# one, like refused_among, and for a second DBUS_SESSION_BUS_ADDRESS entry.
refused_entries() {
  local place=$1 label dbus=0
  while IFS= read -r label; do
    case $label in
      '?') echo "$place: an entry whose name this test cannot read is refused" ;;
      "$dbus_entry")
        dbus=$((dbus + 1))
        ((dbus > 1)) && echo "$place: DBUS_SESSION_BUS_ADDRESS is refused: ${refused[DBUS_SESSION_BUS_ADDRESS]}"
        ;;
      *) refused_among "$place" "$label" ;;
    esac
  done
}

# run_env_words <file>: the words of every run_env=(...) and run_env+=(...)
# statement in <file>, a line each, quotes kept: what it adds whether or not
# the variable is set. Reads the text, so it sees an unset variable's addition.
# A comment, a # starting a word outside quotes, is cut from its line first; a
# quote inside a $(...) is not parsed.
run_env_words() {
  awk '
    function uncomment(line,   k, c, quote, prev) {
      quote = ""; prev = " "
      for (k = 1; k <= length(line); k++) {
        c = substr(line, k, 1)
        if (quote != "") { if (c == quote) quote = "" }
        else if (c == "\"" || c == "\047") quote = c
        else if (c == "#" && prev ~ /[ \t]/) return substr(line, 1, k - 1)
        prev = c
      }
      return line
    }
    { text = text uncomment($0) "\n" }
    END {
      n = length(text); i = 1
      while (match(substr(text, i), /(^|[^A-Za-z0-9_])run_env\+?=\(/)) {
        i += RSTART + RLENGTH - 1
        word = ""; quote = ""; sub_depth = 0
        for (; i <= n; i++) {
          c = substr(text, i, 1)
          if (sub_depth > 0) {
            word = word c
            if (c == "(") sub_depth++
            if (c == ")") sub_depth--
          } else if (c == "$" && substr(text, i + 1, 1) == "(") {
            word = word "$("; sub_depth = 1; i++
          } else if (quote != "") {
            word = word c
            if (c == quote) quote = ""
          } else if (c == "\"" || c == "\047") {
            word = word c; quote = c
          } else if (c ~ /[ \t\n]/) {
            if (word != "") print word
            word = ""
          } else if (c == ")") {
            if (word != "") print word
            break
          } else {
            word = word c
          }
        }
      }
    }' "$1"
}

# static_entries: the labels, for refused_entries, of the entries run-env.sh
# adds to run_env outside the passed list, read off its text. The passed list's
# own append, once, and a copy of run_env itself, are no addition. A write to
# run_env made another way than run_env=(...) or run_env+=(...), by index,
# mapfile, printf -v or eval, cannot be read and is labelled ?.
static_entries() {
  local word loop=0
  while IFS= read -r word; do
    word=${word#[\"\']}
    case $word in
      '$_name=${!_name}"')
        loop=$((loop + 1))
        ((loop > 1)) && echo '?'
        ;;
      '${run_env[@]}"') ;;
      "$dbus_entry" | "$dbus_entry\"") echo "$dbus_entry" ;;
      DBUS_SESSION_BUS_ADDRESS=*) echo DBUS_SESSION_BUS_ADDRESS ;;
      [A-Za-z_]*) echo "${word%%[!A-Za-z0-9_]*}" ;;
      *) echo '?' ;;
    esac
  done < <(run_env_words "$here/run-env.sh")
  grep -vE '^[[:space:]]*#' "$here/run-env.sh" |
    grep -E '(mapfile|readarray)[^#]*[[:space:]]run_env([[:space:]]|$)|printf -v +["'\'']?run_env\[|run_env\[[^]@*]+\]=|(^|[^A-Za-z0-9_])eval[[:space:]]' |
    sed 's/.*/?/'
}

# dynamic_entries: the same labels, read off the run_env that sourcing
# run-env.sh builds in a bare environment holding every refused name and every
# word of run-env.sh that is upper-case or refused, so an entry added some way
# the text scan cannot read, a name fed to the passed list's loop or an
# addition made only when a variable is set, shows up when its variable is set.
# A run-env.sh that fails to source is labelled ?. Prints names, never values.
dynamic_entries() {
  local -a set=()
  local name out
  while IFS= read -r name; do
    set+=("$name=set-for-the-test")
  done < <({
    printf '%s\n' "${!refused[@]}"
    grep -vE '^[[:space:]]*#' "$here/run-env.sh" | grep -oE '[A-Za-z_][A-Za-z0-9_]*' |
      while IFS= read -r name; do
        if [[ $name =~ ^[A-Z][A-Z0-9_]+$ ]] || refusal_why "$name" > /dev/null; then echo "$name"; fi
      done
  } | grep -vxE 'PATH|IFS|BASH.*|PS[0-9]|SHELLOPTS|LC_.*|LANG|LANGUAGE' | sort -u)
  out=$(env -i PATH="$PATH" "${set[@]}" bash -c '
    source "$1" || exit 1
    for kv in "${run_env[@]}"; do
      name=${kv%%=*}
      [[ " ${run_env_passed[*]} " == *" $name "* ]] && continue
      if [[ $kv == "$2" ]]; then echo "$kv"; else echo "$name"; fi
    done' _ "$here/run-env.sh" "$dbus_entry") || echo '?'
  [[ -n $out ]] && echo "$out"
}

# no_refused <case name> <findings>: PASS on no findings, else FAIL and each.
no_refused() {
  if [[ -z $2 ]]; then
    echo "PASS $1"
  else
    echo "FAIL $1"
    printf '  %s\n' "${2//$'\n'/$'\n  '}"
    failed=1
  fi
}
no_refused "the passed list names no credential or way to one" \
  "$(refused_among "the passed list" "${run_env_passed[@]}")"
no_refused "run_env_set_by_run names no credential or way to one" \
  "$(refused_among "run_env_set_by_run" "${run_env_set_by_run[@]}")"
no_refused "run-env.sh adds no credential or way to one to run_env outside the passed list" \
  "$({ static_entries | refused_entries "run_env outside the passed list"; dynamic_entries | refused_entries "run_env outside the passed list"; } | sort -u)"

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
# The function is defined in the bash that sources env.sh, exported, then looked
# for in a child bash it starts; the case prints neither the function nor its body.
check "a shell sourcing run_env_script stops exporting the caller's functions" \
  bash -c 'RUN_ENV_TEST_FUNCTION() { :; }; export -f RUN_ENV_TEST_FUNCTION; source "$1"; ! bash -c "declare -F RUN_ENV_TEST_FUNCTION > /dev/null"' _ "$dir/env.sh"

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

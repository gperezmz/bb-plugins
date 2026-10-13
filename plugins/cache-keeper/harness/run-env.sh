# shellcheck shell=bash
# What a drive harness's run takes from whoever started it: the passed list
# below and nothing else. Cache Keeper's and Unattendish's harnesses and the
# driving-bb-plugins skill's drive-bb-plugins source this file, start every
# process of a run with `env -i "${run_env[@]}"` plus what they set for the
# run, and check for a leak with run_env_record at start and run_env_leaks
# later. A variable a machine needs in its runs goes on the passed list here.
#
# A leak is a variable the caller held at start, same name and value, found in
# a process of the run, its name on neither list below; the variable
# run_env_record plants under a random name is a leak wherever it turns up. The
# record keeps each variable's name and a salted SHA-256 of its value, never
# the value, and the check prints names alone.

run_env_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
run_env_file=$run_env_dir/run-env.sh

# The passed list: each variable passed from the caller to a run, and why.
run_env_passed=(
  PATH                       # finds node, bb, git, Chromium and every tool a run starts
  LANG LANGUAGE LC_ALL LC_CTYPE LC_COLLATE LC_MESSAGES LC_NUMERIC LC_TIME LC_MONETARY
                             # the locale text, numbers and dates render in
  LOCALE_ARCHIVE             # where NixOS's glibc finds the locales LANG names
  TZ TZDIR                   # the time zone dates render in, and where its rules are
  XDG_DATA_DIRS XDG_CONFIG_DIRS # where fontconfig and Chromium find fonts and icons on NixOS
  USER LOGNAME               # who runs it, which git and Node's os.userInfo read
  CHROMIUM_PATH              # the Chromium a ui step or verb launches
  PLAYWRIGHT_BROWSERS_PATH   # where Playwright finds its own browsers when CHROMIUM_PATH names none
  NIX_LD NIX_LD_LIBRARY_PATH # how NixOS runs a prebuilt binary, such as an npm package's
  HTTPS_PROXY HTTP_PROXY NO_PROXY https_proxy http_proxy no_proxy NODE_USE_ENV_PROXY
                             # the proxy bb's plugin install reaches registry.npmjs.org through
  NODE_EXTRA_CA_CERTS SSL_CERT_FILE NIX_SSL_CERT_FILE
                             # the certificate authorities that proxy needs
)

# Names the harness, bb or Claude Code set in a run's processes to a value that
# can equal the caller's own, which are therefore no leak, each with why.
run_env_set_by_run=(
  SHELL                      # the harness sets bash, and Claude Code the bash it resolves, which may be the caller's
  DISABLE_AUTOUPDATER        # the harness sets 1 for Claude Code, as Claude Code's own caller often has
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC # likewise
  CLAUDECODE CLAUDE_CODE_ENTRYPOINT CLAUDE_AGENT_SDK_VERSION CLAUDE_CODE_EXECPATH COREPACK_ENABLE_AUTO_PIN
  AI_AGENT DISABLE_INSTALLATION_CHECKS DISABLE_NON_ESSENTIAL_MODEL_CALLS CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION
  CLAUDE_CODE_SHELL CLAUDE_EFFORT CLAUDE_CODE_CHILD_SESSION CLAUDE_CODE_SESSION_ATTENDED GIT_EDITOR
  NoDefaultCurrentDirectoryInExePath CLAUDE_CODE_DISABLE_1M_CONTEXT
                             # bb sets these for Claude Code, or Claude Code for its commands, as for the caller's
  NODE_PATH                  # bb's launcher scripts set it to bb's own modules, as they did in the caller's bb
  PWD OLDPWD SHLVL _         # every shell sets them, to the directory and depth it runs at
  BB_CLI                     # bb points its threads at its own CLI, the caller's bb when it runs the same install
  BB_TELEMETRY               # the harness turns bb's telemetry off, as a caller may have
  GIT_AUTHOR_NAME GIT_AUTHOR_EMAIL GIT_COMMITTER_NAME GIT_COMMITTER_EMAIL
                             # the harness names the drives' commits' author
  DBP_RUN DBP_SCRATCH_ROOT DBP_EVIDENCE_ROOT
                             # drive-bb-plugins names the run to itself, as a caller picking it does
)

# NAME=value for every variable on the passed list the caller has set.
run_env=()
for _name in "${run_env_passed[@]}"; do
  [[ -n ${!_name+x} ]] && run_env+=("$_name=${!_name}")
done
unset _name
# Claude Code's shell is bash, whatever shell the caller logs in with, and the
# bash it runs commands in skips the system bashrc, which on NixOS sources the
# machine's profile into every bash, so nothing that profile exports enters a
# run. No process of a run reaches the user's D-Bus session bus, where a
# keyring would hand gh, and through it bb, the user's token.
run_env+=("SHELL=$(command -v bash)" NOSYSBASHRC=1 "DBUS_SESSION_BUS_ADDRESS=disabled:")

# The line a failed start ends with, so a variable a machine needs can be added.
run_env_note() {
  echo "a run passes only the variables named in $run_env_file (run_env_passed); one this machine needs goes there"
}

# The branch git names for a new repository from this caller's settings, which
# a run's git, with the run's HOME, would not read: `git var GIT_DEFAULT_BRANCH`
# in a git with no repository, so a repository the caller stands in does not
# answer with its own init.defaultBranch. Fails, printing git's reason, on a
# setting git refuses, such as an empty one.
run_env_default_branch() {
  GIT_DIR=/dev/null git var GIT_DEFAULT_BRANCH
}

# run_env_record <file>: records, in <file>, every variable of this process's
# environment not on the passed list, by name and salted hash, then plants a
# randomly named variable, exported, that counts as a leak wherever it turns
# up. Call it from start, before anything of the run is started.
run_env_record() {
  local file=$1 salt kv name hash plant
  salt=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')
  plant=RUN_ENV_PLANT_$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')
  (
    umask 077
    {
      printf 'salt %s\nplant %s\n' "$salt" "$plant"
      while IFS= read -r -d '' kv; do
        name=${kv%%=*}
        [[ " ${run_env_passed[*]} " == *" $name "* ]] && continue
        hash=$(printf '%s%s' "$salt" "${kv#*=}" | sha256sum | cut -c1-64)
        printf 'var %s %s\n' "$name" "$hash"
      done < <(env -0)
    } > "$file"
  )
  export "$plant=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
}

# run_env_leaks <file> <pid>...: prints one line per leak in those processes,
# naming the variable and the process, never a value, then where the passed
# list is kept, and returns 1 when there is any; prints nothing and returns 0
# when there is none.
run_env_leaks() {
  local file=$1 salt="" plant="" kind name hash pid comm kv found=0
  shift
  local -A recorded=()
  while read -r kind name hash; do
    case $kind in
      salt) salt=$name ;;
      plant) plant=$name ;;
      var) recorded[$name]=$hash ;;
    esac
  done < "$file"
  for pid in "$@"; do
    [[ -r /proc/$pid/environ ]] || continue
    comm=$(cat "/proc/$pid/comm" 2> /dev/null || echo '?')
    while IFS= read -r -d '' kv; do
      name=${kv%%=*}
      if [[ $name == "$plant" ]]; then
        echo "leak: $name, planted by start, is in process $pid ($comm)"
        found=1
      elif [[ -n ${recorded[$name]:-} && " ${run_env_passed[*]} ${run_env_set_by_run[*]} " != *" $name "* ]]; then
        hash=$(printf '%s%s' "$salt" "${kv#*=}" | sha256sum | cut -c1-64)
        [[ $hash == "${recorded[$name]}" ]] && { echo "leak: $name, the caller's own, is in process $pid ($comm)"; found=1; }
      fi
    done < "/proc/$pid/environ" 2> /dev/null
  done
  if ((found)); then
    run_env_note
    return 1
  fi
  return 0
}

# run_env_gh_token <command>...: whether gh, run as a process of the run by
# <command> (a harness's env -i prefix), finds a GitHub token, which bb hands
# every thread it starts; prints nothing either way. False when gh is absent.
run_env_gh_token() {
  command -v gh > /dev/null || return 1
  "$@" gh auth token --hostname github.com > /dev/null 2>&1
}

# run_env_start_check <script> <file> <command> -- <pid>...: the check a
# harness with no doctor runs at the end of its start. On a leak in those
# processes it prints run_env_leaks' report, each line headed "<script>: ",
# and when gh run by <command> finds a GitHub token it says so, with where the
# passed list is kept; then it exits 1.
run_env_start_check() {
  local script=$1 file=$2 leaks bad=0
  local -a command=()
  shift 2
  while [[ $1 != -- ]]; do command+=("$1"); shift; done
  shift
  if ! leaks=$(run_env_leaks "$file" "$@"); then
    printf '%s\n' "$leaks" | sed "s/^/$script: /" >&2
    bad=1
  fi
  if run_env_gh_token "${command[@]}"; then
    echo "$script: gh run inside the run finds a GitHub token, which bb would hand its threads" >&2
    ((bad)) || echo "$script: $(run_env_note)" >&2
    bad=1
  fi
  ((bad)) || return 0
  echo "$script: stop what started with harness/stop.sh" >&2
  exit 1
}

# The start of a run's env.sh, which a shell sources to reach the run: every
# variable the shell exports that is not on the passed list stops being
# exported, so a command it sends the run carries only that list and what
# env.sh goes on to set.
run_env_script() {
  cat << ENV
# Keeps every command this shell runs to the passed list in $run_env_file
# and what follows.
_passed=" ${run_env_passed[*]} "
for _v in \$(compgen -e); do [[ \$_passed == *" \$_v "* ]] || export -n "\$_v"; done
while read -r _ _ _v; do export -fn "\$_v"; done < <(declare -Fx)
unset _passed _v
ENV
}

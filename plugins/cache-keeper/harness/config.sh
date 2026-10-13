# The harness's directory and ports, shared by every script. Each can be set
# in the environment; the defaults stay clear of the npm-install check's
# 39886/39887 and of a bb on its usual ports.
#
#   CK_HARNESS_DIR          the throwaway bb's run directory (default /tmp/ck-harness)
#   CK_HARNESS_API_PORT     the fake Anthropic API (default 40180)
#   CK_HARNESS_SERVER_PORT  the bb server (default 40186)
#   CK_HARNESS_DAEMON_PORT  the host daemon (default 40187)
harness=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
plugin_src=$(cd "$harness/.." && pwd)
run=${CK_HARNESS_DIR:-/tmp/ck-harness}
api_port=${CK_HARNESS_API_PORT:-40180}
server_port=${CK_HARNESS_SERVER_PORT:-40186}
daemon_port=${CK_HARNESS_DAEMON_PORT:-40187}
ports=("$api_port" "$server_port" "$daemon_port")
# Every process the harness starts carries this in its environment, so stop.sh
# finds the bb server's detached child, Claude Code and its background
# commands too.
mark="CK_HARNESS=$run"
# The passed list, run_env, and the leak check every process of a run is
# started and checked with.
# shellcheck source-path=SCRIPTDIR source=run-env.sh
source "$harness/run-env.sh"

# Whether something listens on 127.0.0.1:$1.
port_busy() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
}

# The harness's processes, one "pid<TAB>command line" each: every process
# whose environment carries the mark or the throwaway bb's data dir.
harness_procs() {
  local proc pid
  for proc in /proc/[0-9]*; do
    pid=${proc#/proc/}
    [[ $pid == "$$" || $pid == "${BASHPID:-}" ]] && continue
    if grep -qzxE "$mark|BB_DATA_DIR=$run/bb" "$proc/environ" 2>/dev/null; then
      printf '%s\t%s\n' "$pid" "$(tr '\0\n\t' '   ' < "$proc/cmdline" 2>/dev/null | cut -c1-160)"
    fi
  done
}

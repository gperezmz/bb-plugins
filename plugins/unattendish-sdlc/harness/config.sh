# shellcheck shell=bash disable=SC2034
# The harness's directory and ports, shared by every script. Each can be set
# in the environment; the defaults stay clear of the npm-install check's
# 39886/39887 and of a bb on its usual ports.
#
#   UD_HARNESS_DIR            the throwaway bb's run directory (default /tmp/ud-harness)
#   UD_HARNESS_API_PORT       the fake Anthropic API (default 40190)
#   UD_HARNESS_GITHUB_PORT    the fake GitHub (default 40191)
#   UD_HARNESS_GITLAB_PORT    the fake GitLab (default 40192)
#   UD_HARNESS_LINEAR_PORT    the fake Linear (default 40193)
#   UD_HARNESS_JIRA_PORT      the fake Jira (default 40194)
#   UD_HARNESS_SERVER_PORT    the bb server (default 40196)
#   UD_HARNESS_DAEMON_PORT    the host daemon (default 40197)
harness=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
plugin_src=$(cd "$harness/.." && pwd)
fake_anthropic=$(cd "$harness/../../../scripts/harness" && pwd)/fake-anthropic.mjs
run=${UD_HARNESS_DIR:-/tmp/ud-harness}
api_port=${UD_HARNESS_API_PORT:-40190}
github_port=${UD_HARNESS_GITHUB_PORT:-40191}
gitlab_port=${UD_HARNESS_GITLAB_PORT:-40192}
linear_port=${UD_HARNESS_LINEAR_PORT:-40193}
jira_port=${UD_HARNESS_JIRA_PORT:-40194}
server_port=${UD_HARNESS_SERVER_PORT:-40196}
daemon_port=${UD_HARNESS_DAEMON_PORT:-40197}
ports=("$api_port" "$github_port" "$gitlab_port" "$linear_port" "$jira_port" "$server_port" "$daemon_port")
# Every process the harness starts carries this in its environment, so stop.sh
# finds the bb server's detached child, Claude Code and its background
# commands too.
mark="UD_HARNESS=$run"
# The passed list, run_env, and the leak check every process of a run is
# started and checked with, shared with the driving-bb-plugins skill's harness.
# shellcheck source-path=SCRIPTDIR source=../../../scripts/harness/run-env.sh
source "$harness/../../../scripts/harness/run-env.sh"

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

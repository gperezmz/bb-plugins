#!/usr/bin/env bash
# Accounts: a fleet no account covers (a host with none, one that only begins
# with an account's host, or a GitHub owner the account holds no token for)
# registers, shows as not watched with a `no-credential` reason that names what
# it needs, and sends no request to any fake; a fleet whose credential the
# service refuses (a scripted 401) shows as not watched since a time, and its
# manager gets one wake saying so and naming the credential, however many polls
# fail. The tokens the fakes were given are sent to them and appear in no wake,
# status, ledger or log; a token the service rejects, or one of another login, is not
# stored and not echoed. Checked from `fleet status --json`, the manager's
# messages and the fakes' request logs.
# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"
drive credentials
t=$(spawn_manager "drive: credentials")
say "manager $t"

# No account is on the host; the account on gitlab.example does not cover a longer host; the GitHub account on
# github.example holds a token for org alone.
lonely=nocred.example/org/repo
evil=gitlab.example.evil.net/group/proj
other=github.example/other-org/x
manifest "$manifests/lonely.md" "$lonely"
manifest "$manifests/evil.md" "$evil"
manifest "$manifests/other.md" "$other"
out=$(register "$t" "$lonely" forge-issues "$manifests/lonely.md")
check "a fleet no account covers registers, not watched" eq "$(jq -c '[.outcome, .watched, .notWatched[0].code]' <<< "$out")" '["registered",false,"no-credential"]'
check "and the reason names what it needs" contains "$(jq -r '.notWatched[0].text' <<< "$out")" "needs a GitHub or GitLab account that can read org on nocred.example"
out=$(register "$t" "$evil" forge-issues "$manifests/evil.md")
check "so does a fleet on a host that only begins with an account's" eq "$(jq -c '[.outcome, .watched, .notWatched[0].code]' <<< "$out")" '["registered",false,"no-credential"]'
out=$(register "$t" "$other" forge-issues "$manifests/other.md")
check "so does a fleet on an owner the GitHub account holds no token for" eq "$(jq -c '[.outcome, .watched, .notWatched[0].code]' <<< "$out")" '["registered",false,"no-credential"]'
check "and the reason says which owner" eq "$(jq -r '.notWatched[0].text' <<< "$out")" "other-org/x needs a GitHub account that can read other-org"
check "status shows all three not watched, each naming what it needs" eq "$(bb unattendish fleet status --json | jq -c '[.fleets[] | select(.watched == false) | (.notWatched[0].text | (contains("org on nocred.example") or contains("group on gitlab.example.evil.net") or contains("read other-org")))] | sort')" "[true,true,true]"
check "and its accounts line names the account it would read as, and what is missing" eq "$(status "$other" | jq -c '[.accounts[0].role, .accounts[0].account, (.accounts[0].needs | contains("other-org"))]')" '["forge","GitHub · operator",true]'
check "all are polled" wait_until 20 polled "$lonely"
wait_until 20 polled "$evil"
wait_until 20 polled "$other"
check "but no request reached any fake" eq "$(for s in github gitlab linear jira; do fake_requests "$s"; done | jq -s 'map(length) | add')" 0

# A credential the service refuses.
repo=github.example/org/refused
manifest "$manifests/refused.md" "$repo"
fake_state github "$(jq -nc --arg at "$(iso)" '{repos: {"org/refused": {issues: [{number: 7, state: "open", labels: [], assignees: [], creator: "olivia", createdAt: $at, updatedAt: $at}]}}, faults: [{pathIncludes: "/repos/", status: 401}]}')"
out=$(register "$t" "$repo" forge-issues "$manifests/refused.md")
check "a fleet an account reads registers, watched" eq "$(jq -c '[.outcome, .watched]' <<< "$out")" '["registered",true]'
bb unattendish fleet interval "$repo" 30s > /dev/null
check "the manager gets a wake" wait_wakes "$t" 1 40
wake=$(wake_text "$t" 1)
say "wake: $(tr '\n' '|' <<< "$wake")"
check "naming the credential and since when" grep -qE '^Not watched since [0-9T:.Z-]+: the credential for GitHub · operator for org was refused by the service\.$' <<< "$wake"
s=$(status "$repo")
check "status shows it not watched, since a time, naming the credential" eq "$(jq -c '[.watched, .notWatchedSince != null, .notWatched[0].code, (.notWatched[0].text | contains("GitHub · operator for org"))]' <<< "$s")" '[false,true,"credential-refused",true]'
check "the fake was sent the token (an Authorization header) on every request" eq "$(fake_requests github | jq '[.[] | select(.hasAuthorization | not)] | length')" 0
polled=$(polls "$repo")
check "another poll fails" wait_poll "$repo" "$polled" 50
check "and sends no second wake" eq "$(wake_count "$t")" 1

# A token the service rejects, and one that belongs to another login, are not stored; neither is echoed back.
github=$(rpc settings | jq -r '.accounts[] | select(.service == "github") | .id')
fake_state github '{"logins": {"ghp_harness_fake_token": "operator", "ghp_harness_other_login_token": "buser"}}'
rejected=$(rpc connect "$(jq -nc --arg id "$github" '{account: {id: $id}, owner: "org", secret: {kind: "token", token: "ghp_harness_rejected_token"}}')")
check "a token the service rejects is refused" eq "$(jq -r .outcome <<< "$rejected")" refused
wrong=$(rpc connect "$(jq -nc --arg id "$github" '{account: {id: $id}, owner: "org", secret: {kind: "token", token: "ghp_harness_other_login_token"}}')")
check "a token of another login is refused, naming both logins" eq "$(jq -c '[.outcome, (.text | contains("buser") and contains("operator"))]' <<< "$wrong")" '["wrong-login",true]'
check "and neither stored a credential" eq "$(rpc settings | jq '[.accounts[] | select(.service == "github") | .credentials[]] | length')" 1
everything="$rejected$wrong$(bb unattendish fleet status)$(ledger "$repo")$(wakes "$t")"
check "no token is in the status, the ledger or the wake" none_in "$everything"
check "no token is in bb's logs or the harness's" eq "$(grep -rlE 'ghp_harness_|harness-fake-token' "$run"/*.log "$run/bb/logs" 2> /dev/null | wc -l)" 0
finish

# bb plugins

Plugins that extend bb, the agentic IDE, and the words they share.

## Language

**Compatibility run**:
The scheduled CI run that checks every plugin against bb releases newer than the one the plugins pin.
_Avoid_: Canary, nightly check, smoke test

**Channel**:
The bb release line a compatibility run tests, named by its npm dist-tag: one for releases, one for nightly builds.
_Avoid_: Track, release stream

**Thread tree**:
A top-level thread and every thread below it, its child threads and theirs.
_Avoid_: Family, thread family, waiting tree

**Fixture**:
The configuration and the assertions the npm-install check applies to one plugin after installing it, to exercise what the plugin registers.
_Avoid_: Scenario, smoke config

**bb core**:
What bb itself does for every plugin through the SDK and the host: its thread actions, read, pin, archive and section state, project operations, how a new thread is created, and what the host passes a surface. A plugin follows it, so a bb release does not break the plugin.
_Avoid_: Native bb, bb's own behaviour

**Built-in thread list**:
The `thread-list` plugin bb ships, which draws the sidebar's thread list unless a plugin replaces it. Its preferences, row buttons, sort and folding are its own design, not bb core: a replacement keeps its own instead of reading them.
_Avoid_: bb's thread list plugin, default list

**Drive snapshot**:
A throwaway bb the driving-bb-plugins skill saved, with its threads, settings, project repository and Claude Code sessions, which a drive starts from a copy of.
_Avoid_: Saved run, drive fixture

**Passed list**:
The variables a run of a drive harness takes from whoever started it, each named with why; a run's processes hold these and what the harness sets for the run, and nothing else of the caller's environment.
_Avoid_: Allowlist, inherited environment

**Leak**:
A variable the caller of a drive harness held at `start`, with the same name and value, found in a process of the run while its name is not on the passed list; the variable `start` plants under a random name is a leak wherever it turns up. Names the harness, bb or Claude Code set in a run's processes to a value that can equal the caller's are listed beside the passed list, and are no leak.
_Avoid_: Credential leak, exposed variable

**Refused name**:
A name a drive harness's environment never holds, on the passed list, beside it or among what the harness adds to a run: a credential, a variable pointing at where one is kept, or any name containing TOKEN, SECRET, PASS, KEY, AUTH or CREDENTIAL in any letter case. A name that matches a pattern but has to be there is excepted from the patterns alone, with why.
_Avoid_: Blocklist, forbidden variable

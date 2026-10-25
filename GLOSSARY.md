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

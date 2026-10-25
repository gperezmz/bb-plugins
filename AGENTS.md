## Agents

Name the kind of work a subagent or a thread gets as Cynefin sorts it, by when
its cause and effect can be known, and take its model, and its effort where the
harness takes one, from that kind's column for the harness it runs on, whatever
model you are running on; this section is the explicit request an effort waits
for.

- `clear` work has a cause and effect that is plain before the work
  starts, without analysis.
- `complicated` work has a cause and effect that analysis can know
  before the work starts.
- `complex` work has a cause and effect that only probing shows, in
  retrospect.

A skill that names the kind of a subagent's or a thread's work decides it. The
kind of work sets the model, and high stakes alone leave the kind as it is.

| Harness | `clear` | `complicated` | `complex` |
| --- | --- | --- | --- |
| Claude Code | `haiku` high | `sonnet` high | `opus` medium |
| Copilot | `gpt-6-luna` medium | `claude-sonnet-5.5` high | `claude-opus-5.5` medium |
| Cursor | `claude-haiku-5-5` high | `grok-4.7` high | `claude-opus-5-5` medium |

A harness with no row, or one that rejects a model, takes the nearest model its
own list offers to that kind's column, and says so. A subagent's or a thread's
brief is all it knows beyond the checkout: write down what only this context
holds, give paths for what it can read itself, and state the job as its own to
do.

## Glossary

The words the user and the model have settled are in `GLOSSARY.md` at the root,
or, where a `GLOSSARY-MAP.md` sits at the root, in the `GLOSSARY.md` beside each
bounded context's code that the map lists. Work in the glossary's words. Call
the Skill tool with `naming-concepts` where the user decides or accepts a word
for something the work is about, since only such a word goes in.

## Claims

What you know about anything outside this repository is answered directly,
unless it may not match the version or date in use and a wrong guess would
not show in a run made first. There, call the Skill tool with `researching`
before code, a decision or a criterion rests on it.

## Comments

A comment or docstring carries what the code cannot state about itself and
describes the code as it stands; how it came to be goes in the commit message.
A change that alters behaviour changes every comment describing it, on the
lines it touched and on the paths that call or mirror them. Comments and
docstrings follow the convention the repository's linter is configured for,
which then reports nothing on the lines written or changed, else the Google
style guide for the file's language, else the language's own convention.

## Skills and tool descriptions

Call the Skill tool with `writing-for-agents` before writing or changing a
skill or an agent tool description.

## Artifacts

The lessons directory is `docs/lessons/`, and the ideation directory
`docs/ideation/`.

## Lessons

When you are about to report a problem solved and verified, or to open its pull
request where that comes first, and no skill running the work records a lesson
itself, nor does the brief you work under name who records it, ask the user
once whether to call the Skill tool with `recording-lessons`. Ask only where
whoever meets the problem next, reading the final code, tests and docs, would
still repeat the mistake or redo a substantial investigation; the effort and
the size of the diff count for nothing toward it. With nobody to answer, call
the Skill tool with `recording-lessons`, since the lesson lands with the work,
where whoever merges it reads it.

## Forge and tracker

### Services

| Role | Service | Scope | Tool |
| --- | --- | --- | --- |
| tracker | GitHub | `gperezmz/bb-plugins` | `gh` |
| forge | GitHub | `gperezmz/bb-plugins` | `gh` |

### Labels

| Meaning | Label |
| --- | --- |
| spec | `spec` |
| ready | `status:ready` |
| in progress | `status:in progress` |
| needs input | `status:needs input` |

## Ground rules

What holds in every run, whatever skill or route it takes.

- **What others made stands.** Anything this run did not make, such as commits
  someone else pushed, their uncommitted edits, text they wrote or a process
  they started, is never forced, rewritten, stashed, stopped or removed, since
  its maker may be building on it and nothing gives it back. Where the work
  cannot go on without moving it, stop and name what is in the way.
- **Secrets.** A secret's value reaches nothing shown, kept or committed.

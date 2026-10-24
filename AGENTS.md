## Agents

Name the kind of work a subagent gets as Cynefin sorts it, by when its
cause and effect can be known, and take its model, and its effort where your
harness takes one, from that kind's column for your harness, whatever model
you are running on; this section is the explicit request an effort waits for.

- `clear` work has a cause and effect that is plain before the work
  starts, without analysis.
- `complicated` work has a cause and effect that analysis can know
  before the work starts.
- `complex` work has a cause and effect that only probing shows, in
  retrospect.

A skill that names the kind of a subagent's work decides it. Judging work
someone else wrote takes the kind of what the judge has to find, one kind up
where that is unclear, since a judge sized too small misses what it was there
for and shows it only as a narrower verdict. The kind of work sets the model,
and high stakes alone leave the kind as it is.

| Harness | `clear` | `complicated` | `complex` |
| --- | --- | --- | --- |
| Claude Code | `haiku` high | `sonnet` high | `opus` medium |
| Copilot | `gpt-6-luna` medium | `claude-sonnet-5.5` high | `claude-opus-5.5` medium |
| Cursor | `claude-haiku-5-5` high | `grok-4.7` high | `claude-opus-5-5` medium |

A harness with no row, or one that rejects a model, takes the nearest model
its own list offers to that kind's column, and says so. A subagent's brief is
all it knows beyond the checkout: write down what only this session holds,
give paths for what it can read itself, and state the job as its own to do.

## Glossary

The words this repository has settled are in `GLOSSARY.md` at the root, or,
where a `GLOSSARY-MAP.md` sits at the root, in the `GLOSSARY.md` beside each
context's code that the map lists. Call the Skill tool with `naming-concepts`
before naming anything the work is about.

## Claims

A claim about how anything from outside this repository behaves at the version
in use, or about what exists outside it to choose from, is read before code or
a decision rests on it: call the Skill tool with `researching` rather than
writing or answering from what you remember. What any engineer knows without
checking is answered directly.

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

When you are about to report a problem solved and verified, or to open its
pull request where that comes first, and no skill running the work records a
lesson itself, ask the user once whether to call the Skill tool with
`recording-lessons`. Ask only where whoever meets the problem next, reading
the final code, tests and docs, would still repeat the mistake or redo a
substantial investigation; the effort and the size of the diff count for
nothing toward it. With nobody to answer, record nothing: the report names
what the work taught and suggests `/recording-lessons`.

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

- **Waiting.** A wait ends when the work ends, failed or not: wait for a
  subagent or background work by ending your turn, so its end wakes you, never
  by a loop on a result a failure never brings, and work detached from the tool
  that started it wakes nobody. A reply sent while work still runs says what
  still runs, so whoever started you does not take it for your result, and a
  subagent's reply saying so of its own work is not its result either.
- **Asking.** The user's attention goes only to what only they can decide and to
  one-way doors; nothing a lookup settles is asked, and nothing twice. A
  question goes through the question tool, your recommendation first, each
  option with what it gives and costs, and a **one-way door** marked with what
  reversing it costs; a skill decides when it asks and which questions go
  together, never this shape. Where nobody will answer, as in a run started
  unattended, each question but a one-way door takes your recommendation, named
  as an assumption where whoever reads the result will see it, and a one-way
  door stops the work where it stands, named, unless the skill says what becomes
  of its own questions then.
- **What others made stands.** Anything this run did not make, such as commits
  someone else pushed, their uncommitted edits, text they wrote or a process
  they started, is never forced, rewritten, stashed, stopped or removed, since
  its maker may be building on it and nothing gives it back. Where the work
  cannot go on without moving it, stop and name what is in the way.
- **What a revert cannot undo**, such as a message to a person, a payment, or
  data others depend on, waits on the user's word.
- **Secrets.** A secret's value reaches nothing shown, kept or committed.
- **Scratch.** What a run writes outside its checkout goes in a directory of
  its own made with `mktemp -d`, under `$BB_THREAD_STORAGE` where it is set,
  else `$TMPDIR` or `/tmp`, and is removed by the exact path `mktemp` printed,
  never by a pattern, once nothing the run reports is in it, since other runs
  keep theirs beside it and a full disk takes every session on the machine
  down.

## Agents

Name the kind of work a subagent gets as Cynefin sorts it, and take its
model, and its effort where your harness takes one, from that kind's column
for your harness, whatever model you are running on; this section is the
explicit request an effort waits for.

- `clear` work has one right answer the agent can recognise when it finds
  it.
- `complicated` work has a settled goal, and the agent works out how to
  reach it.
- `complex` work leaves the goal to the agent's judgement, or leaves
  unclear what is wrong or wanted.

A skill that names the kind of a subagent's work decides it; otherwise
judging work someone else wrote is `complex` work, since the judge has to
find what the writer missed. The kind of work sets the model, and high
stakes alone leave the kind as it is.

| Harness | `clear` | `complicated` | `complex` |
| --- | --- | --- | --- |
| Claude Code | `haiku` high | `sonnet` high | `opus` medium |
| Copilot | `gpt-6-luna` medium | `claude-sonnet-5.5` high | `claude-opus-5.5` medium |
| Cursor | `claude-haiku-5-5` high | `grok-4.7` high | `claude-opus-5-5` medium |

If your harness rejects a model, say so, and take the nearest one it lists.
A subagent's brief is all it knows beyond the checkout: write down what only
this session holds, give paths for what it can read itself, and state the
job as its own to do.

## Glossary

The words this repository has settled are in `GLOSSARY.md` at the root, or,
where a `GLOSSARY-MAP.md` sits at the root, in the `GLOSSARY.md` beside each
part's code that the map lists. Call the Skill tool with `naming-concepts`
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

Specs and issues go to GitHub issues, `gperezmz/bb-plugins`, through `gh`.
Pull requests go to GitHub, `gperezmz/bb-plugins`, through `gh`.

| Meaning | Label |
| --- | --- |
| spec | `spec` |
| ready | `status:ready` |

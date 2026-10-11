---
title: Role queries over a long list in jsdom run a test past its timeout on a busy machine
date: 2026-10-11
category: test-failures
module: plugins/thread-glance
problem_type: test_failure
component: thread-list
severity: medium
symptoms:
  - "A jsdom test that draws a long list fails with 'Test timed out in 5000ms.' in some full runs under CPU load, and passes alone and on an idle machine"
  - "The failing test's duration in the vitest JSON report swings from under 1 s alone on an idle machine to 2.3 to 6.6 s under load"
tags: [flaky-test, jsdom, testing-library, getbyrole, timeout, cpu-load, vitest]
---

# Role queries over a long list in jsdom run a test past its timeout on a busy machine

## Problem

Thread Glance's settled paging test, which draws 50 Settled rows, timed out at
vitest's 5000 ms in 3 of 10 full runs of the suite with every core busy (#232).
Nothing in it waited on a clock: the time went to Testing Library's role
queries.

## Symptoms

- `FAIL |unit| features/thread-list/components/list.test.tsx > settled paging > shows 10 rows, then Load N more in pages of 25`, `Error: Test timed out in 5000ms.`, at 5504, 5780 and 6609 ms.
- Its passing runs under the same load took 2.3 to 5 s; alone on an idle
  machine it took 0.76 s, per this session's measurement.

## What Didn't Work

- Raising `--maxWorkers` to twice the core count reproduced nothing in 10 runs:
  the extra workers did not slow this test enough. One busy-loop shell per
  core did.
- Looking for a real-clock wait in the test: it has none. Its steps
  (`mount`, the clicks, `flush`) took under 100 ms together, per this
  session's measurement.

## Solution

Timing each line of the test showed, per this session's measurement, about
700 of its 760 ms in three role queries made once the list was open:
`getByRole("button", { name: "Load 25 more" })` at 10 rows, the same for
"Load 15 more" at 35 rows, and `queryByRole("button", { name: /Load/ })` at 50
rows. The Load button is a plain `<button>` whose text is its accessible name
(`plugins/thread-glance/features/thread-list/components/ShelfParts.tsx:125`),
so a text query scoped to buttons finds the same element by the same words, in
about 150 ms for all three per this session's measurement
(`plugins/thread-glance/features/thread-list/components/list.test.tsx:128`):

```ts
fireEvent.click(screen.getByText("Load 25 more", { selector: "button" }));
expect(screen.queryByText(/Load/, { selector: "button" })).toBeNull();
```

Under the same load the test then took 0.4 to 0.9 s, and 10 full runs passed.

## Why This Works

A role query given a `name` works out the accessible name of every element in
the document with the role before it filters by name, and only then checks the
matches for being inaccessible (`@testing-library/dom` 10.4.2, its role query).
Working out an accessible name reads computed styles through jsdom's
`getComputedStyle`, and the jsdom setup draws every row of a list
(`plugins/thread-glance/testing/jsdom-viewport.ts:6`), so the cost grows with
the rows drawn and the buttons in each. The test is CPU-bound, so load slowed
it 2 to 6 times here, which at 50 rows carried it past 5 s. A text query with a
selector matches by tag and text content and computes none of it.

What the text query gives up is the role query's check that the element is
exposed as a button with that accessible name. A button whose `aria-label`
differs from its text, or a `div role="button"`, would need the role query.

## Prevention

- In a jsdom test that draws more than a few rows, find elements inside the
  list by text with a `selector`, or within one row through `within`, and keep
  role queries for small subtrees or for what the test is about (a name or a
  role).
- Raising the timeout leaves the cost in place and grows with the next rows
  added; #232 does not count it as a fix.
- To find which line of a slow test costs the time, write
  `performance.now()` deltas to `process.stderr` after each line and run the
  file alone with `--silent=false`.

## Related

- #232, the spec for removing the suite's timing failures under load; its
  fix is pending, unmerged as of 2026-10-11.

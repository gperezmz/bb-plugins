---
title: A test of a plugin icon by name passes whether or not the icon is registered with bb
date: 2026-10-12
category: best-practices
module: plugins/thread-glance
problem_type: best_practice
component: thread-list
severity: medium
applies_when:
  - "Adding an icon bb lacks to EXTRA_ICONS and drawing it with experimental_Icon"
  - "Writing a test that checks which icon a button or header draws"
  - "Renaming a key in EXTRA_ICONS or the name an experimental_Icon passes"
tags: [icons, experimental-icon, test-sdk, hugeicons, extra-icons, false-green]
---

# A test of a plugin icon by name passes whether or not the icon is registered with bb

## Context

Thread Glance draws its named icons through the plugin SDK's
`experimental_Icon`, and registers the icons bb lacks from `EXTRA_ICONS`
(`plugins/thread-glance/app.tsx:12`). Spec #249 turned Settled's Clean button
into a broom registered as `thread-glance-clean`. Its tests checked the button
for `[data-icon=thread-glance-clean]`, and a review found that deleting the
broom from `EXTRA_ICONS` left every test green, while in bb the button would
show bb's fallback icon instead of the broom.

## Guidance

A test that finds `[data-icon=<name>]` proves only the string the component
passes. Pin the registration separately: every name the list passes to
`experimental_Icon` that bb lacks is listed in a test that asserts it is a key
of `EXTRA_ICONS`, as
`plugins/thread-glance/features/thread-list/icons.test.tsx:22` does for the
shelf icons, the port indicator's plug and Clean's broom. A new icon adds its
name to that list.

## Why This Matters

In tests, `experimental_Icon` is the stand-in that `installTestPluginRuntime`
from `@get-bb/plugin-sdk/testing/app` installs (SDK 0.6.37): a bare span, as
`plugins/thread-glance/features/thread-list/testing/browser.css:21` notes,
carrying `data-icon` set to whatever name it is given. The check in
`icons.test.tsx` that the app registers exactly the keys of `EXTRA_ICONS`
compares the registered names with whatever keys the object holds, and the
drawing test loops over the same object, so neither can notice a key that is
missing or renamed. Only bb resolves the name, and there an unregistered name
draws bb's fallback icon, Zap unless `fallback` names another, per the SDK's
types for `experimental_Icon`; nobody watched it in bb.

## When to Apply

When an icon is added to, renamed in or removed from `EXTRA_ICONS`, and when
a component starts passing a new name to `experimental_Icon`.

## Examples

```tsx
it("include every icon the list names that bb lacks, Clean's broom among them", () => {
  const shelves = SHELVES.map((shelf) => SHELF_ICONS[shelf]).filter((name) => name.startsWith("thread-glance-"));
  const named = [...shelves, "thread-glance-ports", "thread-glance-clean"];
  for (const name of named) expect(Object.keys(EXTRA_ICONS), name).toContain(name);
});
```

## Related

- Spec #249, the Clean broom and the shelf rule.

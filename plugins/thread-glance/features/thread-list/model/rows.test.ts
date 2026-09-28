import { describe, expect, it } from "vitest";
import { makeThread, T0, viewOf, type Scenario } from "../testing/fixtures";
import type { ThreadRow } from "./view";

function rowOf(scenario: Scenario, id: string): ThreadRow {
  for (const group of [...viewOf(scenario).groups, ...viewOf(scenario).more]) {
    for (const row of group.rows) if (row.type === "thread" && row.info.thread.id === id) return row;
  }
  throw new Error(`no row ${id}`);
}

const note = (kind: "question" | "failed", text: string) => ({ kind, text, at: T0 });

describe("a row's second line", () => {
  const branched = makeThread({ id: "b", environment: { branchName: "fix/login" } });
  const onMain = makeThread({ id: "m", environment: { branchName: "main" } });
  const noBranch = makeThread({ id: "n", environment: null });
  const asks = makeThread({ id: "q", hasPendingInteraction: true, environment: { branchName: "fix/q" } });
  const child = makeThread({ id: "c", parentThreadId: "b", createdAt: T0 + 1, environment: { branchName: "fix/child" } });
  const threads = [branched, onMain, noBranch, asks, child];
  const notes = { q: { pending: note("question", "Tabs or spaces?") } };
  const comfortable = { threads, notes, comfortable: true, prefs: { expandedChildren: ["b"] } };
  const compact = { ...comfortable, comfortable: false };

  it("in Comfortable, shows a branch that is not the project's default, with its pull request badge after it", () => {
    expect(rowOf(comfortable, "b")).toMatchObject({ branchLine: "fix/login", pullRequest: "second-line", note: null });
    expect(rowOf(comfortable, "c")).toMatchObject({ branchLine: "fix/child", pullRequest: "second-line" });
  });

  it("draws no second line on the default branch, with no branch, or before the default branch is known", () => {
    expect(rowOf(comfortable, "m")).toMatchObject({ branchLine: null, pullRequest: null, note: null });
    expect(rowOf(comfortable, "n")).toMatchObject({ branchLine: null, pullRequest: null, note: null });
    expect(rowOf({ ...comfortable, defaultBranches: {} }, "b")).toMatchObject({ branchLine: null, pullRequest: null });
  });

  it("gives the line to a note, in both densities, and keeps the badge on the title line then", () => {
    expect(rowOf(comfortable, "q")).toMatchObject({ branchLine: null, pullRequest: "title" });
    expect(rowOf(comfortable, "q").note).not.toBeNull();
    expect(rowOf(compact, "q").note).not.toBeNull();
  });

  it("in Compact, draws no branch line and keeps the badge on a root's title line off the default branch, as before", () => {
    expect(rowOf(compact, "b")).toMatchObject({ branchLine: null, pullRequest: "title" });
    expect(rowOf(compact, "c")).toMatchObject({ branchLine: null, pullRequest: null });
    expect(rowOf(compact, "m")).toMatchObject({ branchLine: null, pullRequest: null });
  });

  it("never has both a note and a branch line", () => {
    for (const scenario of [comfortable, compact]) {
      for (const id of ["b", "m", "n", "q", "c"]) {
        const row = rowOf(scenario, id);
        expect(row.note !== null && row.branchLine !== null).toBe(false);
      }
    }
  });
});

describe("the machine tag", () => {
  const threads = [
    makeThread({ id: "here", host: { id: "host_1", name: "dev-box" } }),
    makeThread({ id: "there", host: { id: "host_2", name: "work" } }),
    makeThread({ id: "c", parentThreadId: "here", createdAt: T0 + 1, host: { id: "host_2", name: "work" } }),
    makeThread({ id: "none", host: null }),
  ];
  const scenario = { threads, prefs: { expandedChildren: ["here"] } };

  it("names a machine other than bb's primary, at any depth, in both densities", () => {
    expect(rowOf(scenario, "there").machine).toBe("work");
    expect(rowOf(scenario, "c").machine).toBe("work");
    expect(rowOf({ ...scenario, comfortable: true }, "there").machine).toBe("work");
  });

  it("names none on the primary machine, with no machine, or while bb's primary is unknown", () => {
    expect(rowOf(scenario, "here").machine).toBeNull();
    expect(rowOf(scenario, "none").machine).toBeNull();
    expect(rowOf({ ...scenario, primaryHostId: null }, "there").machine).toBeNull();
  });

  it("names none while the list is grouped by machine", () => {
    const byMachine = { ...scenario, prefs: { ...scenario.prefs, organizationMode: "machine" as const } };
    for (const id of ["here", "there", "none"]) expect(rowOf(byMachine, id).machine).toBeNull();
  });
});

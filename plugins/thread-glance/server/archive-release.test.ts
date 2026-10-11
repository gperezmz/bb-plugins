import { describe, expect, it } from "vitest";
import { createArchiveRelease } from "./archive-release";
import { createFakeRuntime, createFakeThreads, makeServerThread } from "./testing/fakes";

describe("archive release", () => {
  it("stops the archived thread's runtime and its idle children's, and leaves a working child alone", async () => {
    // bb's snapshot lists no archived thread, so the archived one is absent.
    const threads = createFakeThreads([
      makeServerThread("idle-child", { parentThreadId: "parent" }),
      makeServerThread("working-child", { parentThreadId: "parent", status: "active" }),
      makeServerThread("asking-child", { parentThreadId: "parent", hasPendingInteraction: true }),
      makeServerThread("monitor-child", { parentThreadId: "parent", runtimeStatus: "active" }),
      makeServerThread("grandchild", { parentThreadId: "idle-child" }),
      makeServerThread("other"),
    ]);
    const runtime = createFakeRuntime();
    await createArchiveRelease({ threads, runtime })("parent");
    expect(runtime.stopped.sort()).toEqual(["idle-child", "parent"]);
  });

  it("releases the archived thread even when bb cannot list its children, and never rejects", async () => {
    const threads = createFakeThreads();
    threads.snapshot = async () => {
      throw new Error("bb is down");
    };
    const runtime = createFakeRuntime();
    runtime.failStop.add("child");
    const warnings: string[] = [];
    await createArchiveRelease({ threads, runtime, warn: (m) => warnings.push(m) })("parent");
    expect(runtime.stopped).toEqual(["parent"]);
    expect(warnings).toHaveLength(1);
  });
});

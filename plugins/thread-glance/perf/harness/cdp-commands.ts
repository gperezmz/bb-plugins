// Browser commands for the Chromium step: the DevTools protocol through a
// session of the harness's own, opened from node, since a fresh session is
// what reports the test frame's execution context, where the list's objects
// live.
import type { BrowserCommand } from "vitest/node";
import type { CDPSession, Page } from "playwright";

interface PageSession {
  session: CDPSession;
  contexts: { id: number; frameId: string }[];
}

const sessions = new WeakMap<Page, Promise<PageSession>>();

function sessionFor(page: Page): Promise<PageSession> {
  let pending = sessions.get(page);
  if (pending === undefined) {
    pending = (async () => {
      const session = await page.context().newCDPSession(page);
      const contexts: PageSession["contexts"] = [];
      session.on("Runtime.executionContextCreated", ({ context }) => {
        const aux = context.auxData as { frameId?: string; isDefault?: boolean } | undefined;
        if (aux?.isDefault && aux.frameId) contexts.push({ id: context.id, frameId: aux.frameId });
      });
      session.on("Runtime.executionContextDestroyed", ({ executionContextId }) => {
        const index = contexts.findIndex((context) => context.id === executionContextId);
        if (index >= 0) contexts.splice(index, 1);
      });
      await session.send("Runtime.enable");
      await session.send("Performance.enable");
      return { session, contexts };
    })();
    sessions.set(page, pending);
  }
  return pending;
}

/** Sends one DevTools protocol command for the page and answers its result. */
export const perfCdp: BrowserCommand<[method: string, params?: Record<string, unknown>]> = async (context, method, params) => {
  const { session } = await sessionFor(context.page);
  return session.send(method as never, params as never);
};

/** Live instances of a constructor the test frame's globals hold, such as IntersectionObserver. */
export const perfLiveInstances: BrowserCommand<[constructorName: string]> = async (context, constructorName) => {
  const { session, contexts } = await sessionFor(context.page);
  const frame = await context.frame();
  const tree = (await session.send("Page.getFrameTree")) as { frameTree: FrameTree };
  const frameId = findFrame(tree.frameTree, frame.url());
  const executionContext = contexts.find((candidate) => candidate.frameId === frameId);
  if (executionContext === undefined) throw new Error("no execution context for the test frame");
  const prototype = await session.send("Runtime.evaluate", { expression: `${constructorName}.prototype`, contextId: executionContext.id });
  const found = await session.send("Runtime.queryObjects", { prototypeObjectId: prototype.result.objectId! });
  const length = await session.send("Runtime.callFunctionOn", {
    functionDeclaration: "function () { return this.length; }",
    objectId: found.objects.objectId!,
    returnByValue: true,
  });
  await session.send("Runtime.releaseObject", { objectId: found.objects.objectId! });
  await session.send("Runtime.releaseObject", { objectId: prototype.result.objectId! });
  return length.result.value as number;
};

interface FrameTree {
  frame: { id: string; url: string };
  childFrames?: FrameTree[];
}

function findFrame(tree: FrameTree, url: string): string | undefined {
  if (tree.frame.url === url) return tree.frame.id;
  for (const child of tree.childFrames ?? []) {
    const found = findFrame(child, url);
    if (found !== undefined) return found;
  }
  return undefined;
}

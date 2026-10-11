import { afterEach, describe, expect, it, vi } from "vitest";
import { IconLoader, type IconEnv } from "./icon-loader";

afterEach(() => vi.useRealTimers());

/** An environment whose icon route answers `answers` in turn (the last one repeating). */
function setup(...answers: (number | "network")[]) {
  const asked: string[] = [];
  const revoked: string[] = [];
  let made = 0;
  const env: IconEnv = {
    async fetch(url) {
      asked.push(url);
      const answer = answers[Math.min(asked.length - 1, answers.length - 1)]!;
      if (answer === "network") throw new TypeError("Failed to fetch");
      // Not a real Response: reading a body takes real I/O, which fake timers do not wait for.
      return { status: answer, ok: answer === 200, blob: async () => new Blob(["x"], { type: "image/png" }) } as Response;
    },
    createObjectUrl: () => `blob:icon-${++made}`,
    revokeObjectUrl: (url) => void revoked.push(url),
    setTimeout: (run, ms) => setTimeout(run, ms),
    clearTimeout: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
  };
  return { loader: new IconLoader(env), asked, revoked };
}

const settle = () => vi.advanceTimersByTimeAsync(0);

describe("IconLoader", () => {
  it("reads a project's icon and tells its listeners", async () => {
    vi.useFakeTimers();
    const { loader } = setup(200);
    const heard = vi.fn();
    loader.subscribe(heard);
    loader.want("p", "/icon?project=p");
    expect(loader.url("p", "/icon?project=p")).toBeNull();
    await settle();
    expect(loader.url("p", "/icon?project=p")).toBe("blob:icon-1");
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("asks once for a project with no icon, however long it sits and however many rows ask (AC2)", async () => {
    vi.useFakeTimers();
    const { loader, asked } = setup(204);
    for (let row = 0; row < 14; row += 1) loader.want("p", "/icon?project=p");
    await settle();
    await vi.advanceTimersByTimeAsync(120_000);
    loader.want("p", "/icon?project=p");
    expect(asked).toEqual(["/icon?project=p"]);
    expect(loader.url("p", "/icon?project=p")).toBeNull();
  });

  it("keeps asking on a growing wait while the icon is unreadable, and shows it once a request succeeds (AC3)", async () => {
    vi.useFakeTimers();
    const { loader, asked } = setup(503, 503, "network", 200);
    loader.want("p", "/icon?project=p");
    await settle();
    expect(asked).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(asked).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(asked).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(asked).toHaveLength(3);
    expect(loader.url("p", "/icon?project=p")).toBeNull();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(asked).toHaveLength(4);
    expect(loader.url("p", "/icon?project=p")).toBe("blob:icon-1");
    await vi.advanceTimersByTimeAsync(600_000);
    expect(asked).toHaveLength(4);
  });

  it("asks again when the URL changes, as an upload or its removal changes it (AC4)", async () => {
    vi.useFakeTimers();
    const { loader, asked, revoked } = setup(204, 200, 204);
    loader.want("p", "/icon?project=p");
    await settle();
    loader.want("p", "/icon?project=p&v=42");
    await settle();
    expect(loader.url("p", "/icon?project=p&v=42")).toBe("blob:icon-1");
    expect(loader.url("p", "/icon?project=p")).toBeNull();
    loader.want("p", "/icon?project=p");
    await settle();
    expect(asked).toEqual(["/icon?project=p", "/icon?project=p&v=42", "/icon?project=p"]);
    expect(revoked).toEqual(["blob:icon-1"]);
  });

  it("drops an answer that arrives after the URL changed", async () => {
    vi.useFakeTimers();
    const { loader, revoked } = setup(200);
    loader.want("p", "/icon?project=p");
    loader.want("p", "/icon?project=p&v=1");
    await settle();
    expect(loader.url("p", "/icon?project=p")).toBeNull();
    expect(loader.url("p", "/icon?project=p&v=1")).toBe("blob:icon-1");
    expect(revoked).toEqual([]);
  });

  it("treats an icon the browser cannot draw as unreadable and asks again after the wait", async () => {
    vi.useFakeTimers();
    const { loader, asked, revoked } = setup(200);
    loader.want("p", "/icon?project=p");
    await settle();
    loader.broke("p", "/icon?project=p");
    expect(loader.url("p", "/icon?project=p")).toBeNull();
    expect(revoked).toEqual(["blob:icon-1"]);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(asked).toHaveLength(2);
    expect(loader.url("p", "/icon?project=p")).toBe("blob:icon-2");
  });
});

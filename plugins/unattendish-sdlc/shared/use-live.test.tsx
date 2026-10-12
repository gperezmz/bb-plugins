// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sdk } from "@/testing/sdk";
import { BOARD_CHANGED } from "./client";
import { FALLBACK_POLL_MS, screenState, useLive } from "./use-live";

vi.mock("@get-bb/plugin-sdk/app", async () => (await import("@/testing/sdk")).sdkModule());

beforeEach(() => sdk.reset());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useLive", () => {
  it("fetches on mount and returns the view", async () => {
    const load = vi.fn(async () => "view");
    const { result } = renderHook(() => useLive(load, []));
    await waitFor(() => expect(result.current.data).toBe("view"));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("fetches again when the server signals the board changed", async () => {
    const load = vi.fn(async () => "view");
    const { result } = renderHook(() => useLive(load, []));
    await waitFor(() => expect(result.current.data).toBe("view"));
    sdk.emit(BOARD_CHANGED);
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  });

  it("fetches again when the connection comes back, but not on the first connection", async () => {
    const load = vi.fn(async () => "view");
    sdk.connection = "connecting";
    const { result } = renderHook(() => useLive(load, []));
    await waitFor(() => expect(result.current.data).toBe("view"));
    sdk.setConnection("connected");
    expect(load).toHaveBeenCalledTimes(1);
    sdk.setConnection("reconnecting");
    sdk.setConnection("connected");
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  });

  it("fetches every minute as a fallback", async () => {
    vi.useFakeTimers();
    const load = vi.fn(async () => "view");
    renderHook(() => useLive(load, []));
    await act(async () => {});
    expect(load).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FALLBACK_POLL_MS);
    });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("keeps the last view and reports why a later fetch failed", async () => {
    const load = vi.fn<() => Promise<string>>().mockResolvedValueOnce("view").mockRejectedValueOnce(new Error("server down"));
    const { result } = renderHook(() => useLive(load, []));
    await waitFor(() => expect(result.current.data).toBe("view"));
    sdk.emit(BOARD_CHANGED);
    await waitFor(() => expect(result.current.error).toBe("server down"));
    expect(result.current.data).toBe("view");
  });

  it("drops a response that arrives after a newer fetch began", async () => {
    let resolveFirst: (value: string) => void = () => {};
    const load = vi
      .fn<() => Promise<string>>()
      .mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)))
      .mockResolvedValueOnce("newer");
    const { result } = renderHook(() => useLive(load, []));
    sdk.emit(BOARD_CHANGED);
    await waitFor(() => expect(result.current.data).toBe("newer"));
    await act(async () => resolveFirst("older"));
    expect(result.current.data).toBe("newer");
  });

  it("fetches nothing while disabled", async () => {
    const load = vi.fn(async () => "view");
    const { result } = renderHook(() => useLive(load, [], false));
    sdk.emit(BOARD_CHANGED);
    await act(async () => {});
    expect(load).not.toHaveBeenCalled();
    expect(result.current.data).toBeNull();
  });

  it("starts again from nothing when what it reads changes", async () => {
    const load = vi.fn(async () => "view");
    const { result, rerender } = renderHook(({ id }) => useLive(load, [id]), { initialProps: { id: "a" } });
    await waitFor(() => expect(result.current.data).toBe("view"));
    rerender({ id: "b" });
    expect(result.current.data).toBeNull();
    await waitFor(() => expect(result.current.data).toBe("view"));
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe("screenState", () => {
  it("is loading until a view or an error arrives", () => {
    expect(screenState({ data: null, error: null })).toBe("loading");
  });
  it("is failed when there is an error and nothing to show", () => {
    expect(screenState({ data: null, error: "x" })).toBe("failed");
  });
  it("is ready with a view, even after a later error", () => {
    expect(screenState({ data: {}, error: "x" })).toBe("ready");
  });
});

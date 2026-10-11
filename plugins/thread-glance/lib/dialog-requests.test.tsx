// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDialogRequests, NEEDS_APP_OVERLAY } from "./dialog-requests";

const toasts = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: toasts.error } }));

beforeEach(() => toasts.error.mockClear());
afterEach(cleanup);

describe("a dialog request", () => {
  it("reaches the host that is mounted", () => {
    const channel = createDialogRequests<string>();
    const heard: string[] = [];
    const listener = (request: string) => heard.push(request);
    function Host() {
      channel.useListener(listener);
      return null;
    }
    render(<Host />);
    channel.request("t1");
    expect(heard).toEqual(["t1"]);
    expect(toasts.error).not.toHaveBeenCalled();
  });

  it("says the action needs bb's app overlay when no host is mounted", () => {
    const channel = createDialogRequests<string>();
    channel.request("t1");
    expect(toasts.error).toHaveBeenCalledWith(NEEDS_APP_OVERLAY);
  });
});

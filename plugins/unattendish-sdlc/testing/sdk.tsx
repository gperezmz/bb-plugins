// A stand-in for `@get-bb/plugin-sdk/app` in screen tests. A test file mocks the SDK with
//   vi.mock("@get-bb/plugin-sdk/app", async () => (await import("@/testing/sdk")).sdkModule());
// and drives the state below: the thread in view, the navigation calls, realtime signals.
import { act } from "@testing-library/react";
import { useEffect, useRef, type AnchorHTMLAttributes, type ReactNode } from "react";
import { vi } from "vitest";

type Handler = (payload: unknown) => void;

export const sdk = {
  context: { projectId: null as string | null, threadId: null as string | null },
  navigate: {
    toThread: vi.fn(),
    toProject: vi.fn(),
    toPluginPanel: vi.fn(),
    openThreadPanel: vi.fn(() => true),
    openUrl: vi.fn(() => true),
  },
  connection: "connected" as "connected" | "connecting" | "reconnecting",
  pluginId: "unattendish-sdlc",
  handlers: new Map<string, Set<Handler>>(),
  /** Delivers a realtime signal to every component listening on the channel. */
  emit(channel: string, payload: unknown = {}) {
    act(() => {
      for (const handler of [...(sdk.handlers.get(channel) ?? [])]) handler(payload);
    });
  },
  reset() {
    sdk.context.projectId = null;
    sdk.context.threadId = null;
    sdk.connection = "connected";
    for (const fn of Object.values(sdk.navigate)) fn.mockClear();
    sdk.handlers.clear();
  },
};

function useRealtime(channel: string, handler: Handler) {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    const listener: Handler = (payload) => latest.current(payload);
    const set = sdk.handlers.get(channel) ?? new Set<Handler>();
    set.add(listener);
    sdk.handlers.set(channel, set);
    return () => {
      set.delete(listener);
    };
  }, [channel]);
}

function UrlLink({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children?: ReactNode }) {
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}

/** The module the mock returns. */
export function sdkModule() {
  return {
    definePluginApp: (setup: unknown) => ({ __bbPluginApp: true, setup }),
    useBbContext: () => sdk.context,
    useBbNavigate: () => sdk.navigate,
    useRealtime,
    useRealtimeConnectionState: () => sdk.connection,
    useSettings: () => ({ values: {}, isLoading: false }),
    useRpc: () => ({ call: async () => ({}) }),
    experimental_usePluginId: () => sdk.pluginId,
    experimental_Icon: ({ name }: { name: string }) => <svg data-icon={name} aria-hidden="true" />,
    Markdown: ({ content }: { content: string }) => <div className="markdown">{content}</div>,
    UrlLink,
  };
}

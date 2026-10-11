// The sidebar list. Its edge feeds bb's hooks into the list store and keeps
// bb's calls behind one reference; everything drawn below reads its own part
// of the store and acts through its commands.
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import {
  experimental_useSidebarThreads as useSidebarThreads,
  useBbNavigate,
  useRpc,
  useSdk,
  useSidebarSplitLayout,
  useSidebarThreadDraftIds,
} from "@get-bb/plugin-sdk/app";
import type { PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import type { RpcContract } from "@/shared/contract";
import { CompactViewportContext } from "@/components/ui/hooks/use-compact-viewport";
import { createCommands } from "../commands/commands";
import { createListStore, type ListStore } from "../store/list-store";
import { ListContext, type ListHandle } from "../store/hooks";
import { ListSyncKeeper } from "../sync/SyncKeeper";
import { ListBody } from "./ListBody";

/** Mounted lists' handles, for tests to reach a list's commands. */
const attachedHandles = new Set<ListHandle>();

export function attachedListHandles(): readonly ListHandle[] {
  return [...attachedHandles];
}

export function ThreadList(props: PluginThreadListProps) {
  const [attempt, setAttempt] = useState(0);
  const onRetry = useCallback(() => setAttempt((value) => value + 1), []);
  return <ThreadListEdge key={attempt} {...props} onRetry={onRetry} />;
}

/**
 * The list's edge: bb's hooks and props go into the store, bb's calls behind
 * its one reference. It renders on every host update; what it draws does not.
 */
function ThreadListEdge({ activeThreadId, isCompactViewport, onNavigate, onRetry }: PluginThreadListProps & { onRetry(): void }) {
  const [handle] = useState<ListHandle>(() => {
    const store: ListStore = createListStore();
    return { store, commands: createCommands(store) };
  });
  const { store } = handle;
  const sidebar = useSidebarThreads();
  const navigate = useBbNavigate();
  const sdk = useSdk();
  const rpc = useRpc<RpcContract>();
  const draftIds = useSidebarThreadDraftIds();
  const splitLayout = useSidebarSplitLayout();
  const host = { status: sidebar.status, threads: sidebar.threads, projects: sidebar.projects, draftIds, splitLayout };
  // The first data is fed before the first draw, so it is drawn at once.
  useState(() => {
    store.feedFocus(activeThreadId, isCompactViewport);
    store.feedHost(host);
  });
  // bb's calls change identity on every host update; commands read them when they run.
  useLayoutEffect(() => {
    store.edge = { navigate, sdk, rpc, onNavigate };
  });
  useLayoutEffect(() => store.feedHost(host));
  useLayoutEffect(() => store.feedFocus(activeThreadId, isCompactViewport), [store, activeThreadId, isCompactViewport]);
  useEffect(() => {
    attachedHandles.add(handle);
    const detach = store.attach();
    return () => {
      detach();
      attachedHandles.delete(handle);
    };
  }, [handle, store]);
  return (
    <CompactViewportContext.Provider value={isCompactViewport}>
      <ListContext.Provider value={handle}>
        <ListSyncKeeper />
        <ListBody onRetry={onRetry} />
      </ListContext.Provider>
    </CompactViewportContext.Provider>
  );
}

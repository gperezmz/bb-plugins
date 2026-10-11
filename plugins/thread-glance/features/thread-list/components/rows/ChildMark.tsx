// The mark before a child thread: a colour circle from the thread's id, or the
// logo of the harness it runs on, as the Child threads setting says. Usable
// outside the list: the caller gives the setting.
import { experimental_ProviderIcon as ProviderIcon, experimental_useProviders as useProviders } from "@get-bb/plugin-sdk/app";
import { cn } from "@/lib/utils";
import type { Settings } from "@/shared/settings";
import { markHue } from "../../model/children-chip";

export function ChildMark({ threadId, providerId, style, className }: { threadId: string; providerId: string; style: Settings["childIcon"]; className?: string }) {
  const { providers } = useProviders();
  if (style === "provider-icon") {
    const provider = providers.find((candidate) => candidate.id === providerId);
    return (
      <span data-child-mark="provider" className={cn("inline-flex size-3.5 shrink-0 text-muted-foreground", className)}>
        <ProviderIcon providerKind="agent" provider={provider ?? { id: providerId }} aria-hidden className="size-3.5" />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      data-child-mark="circle"
      style={{ backgroundColor: `oklch(0.72 0.13 ${markHue(threadId)})` }}
      className={cn("inline-block size-3 shrink-0 rounded-full border border-background", className)}
    />
  );
}

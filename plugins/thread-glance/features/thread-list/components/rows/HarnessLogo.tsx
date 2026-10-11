// The harness a thread runs on: bb's logo for the provider, drawn on every
// full card whatever the thread's state.
import { experimental_ProviderIcon as ProviderIcon, experimental_useProviders as useProviders } from "@get-bb/plugin-sdk/app";
import { cn } from "@/lib/utils";

export function useHarnessName(providerId: string): string {
  const { providers } = useProviders();
  return providers.find((provider) => provider.id === providerId)?.displayName ?? providerId;
}

export function HarnessLogo({ providerId, className }: { providerId: string; className?: string }) {
  const { providers } = useProviders();
  const provider = providers.find((candidate) => candidate.id === providerId);
  const name = provider?.displayName ?? providerId;
  return (
    <span title={name} data-harness={providerId} className={cn("inline-flex size-3.5 shrink-0 text-muted-foreground", className)}>
      <ProviderIcon providerKind="agent" provider={provider ?? { id: providerId }} aria-label={name} className="size-3.5" />
    </span>
  );
}

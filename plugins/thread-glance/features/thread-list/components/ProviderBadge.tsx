// The harness hint: the provider's logo, or a unique two-letter mark.
// Muted by default: a monochrome mask at 60%.
import { experimental_ProviderIcon as ProviderIcon } from "@get-bb/plugin-sdk/app";
import { cn } from "@/lib/utils";
import type { HarnessIcon } from "@/shared/preferences";
import type { ProviderDisplay } from "../model/provider-mark";

export type { ProviderDisplay };

export function ProviderBadge({
  display,
  mode = "muted",
  className,
}: {
  display: ProviderDisplay;
  mode?: HarnessIcon;
  className?: string;
}) {
  const muted = mode === "muted";
  if (display.provider !== null) {
    // Without its tint the logo draws as a currentColor mask.
    const provider = muted ? { id: display.provider.id, logoUrl: display.provider.logoUrl, icon: display.provider.icon } : display.provider;
    return (
      <span
        title={display.name}
        className={cn("inline-flex size-3.5 shrink-0 text-muted-foreground", muted && "opacity-60", className)}
      >
        <ProviderIcon providerKind="agent" provider={provider} aria-label={display.name} className="size-3.5" />
      </span>
    );
  }
  return (
    <span
      role="img"
      aria-label={display.name}
      title={display.name}
      className={cn(
        "inline-flex h-3.5 min-w-3.5 shrink-0 items-center justify-center rounded-[3px] border border-border px-px text-[10px] font-semibold leading-none tracking-tight text-muted-foreground",
        muted && "opacity-60",
        className,
      )}
    >
      {display.mark}
    </span>
  );
}

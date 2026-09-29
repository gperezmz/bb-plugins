// The plugin's settings, under Settings → Plugins → UI Tweaks: one row per
// tweak, laid out like a row of bb's Settings → Appearance.
import { useCallback, useState, useSyncExternalStore, type ReactNode } from "react";
import type { TextSize, Tweaks, Width } from "@/shared/tweaks";
import { useTweaksRpc } from "../api";
import { tweakState } from "../state";
import { SegmentedControl, type Segment } from "./SegmentedControl";

export const TEXT_SIZE_SEGMENTS: readonly Segment<TextSize>[] = [
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
];

export const WIDTH_SEGMENTS: readonly Segment<Width>[] = [
  { value: "narrow", label: "Narrow" },
  { value: "medium", label: "Medium" },
  { value: "wide", label: "Wide" },
];

const subscribe = (onChange: () => void) => tweakState.subscribe(onChange);

export function TweaksSection() {
  const rpc = useTweaksRpc();
  const tweaks = useSyncExternalStore(subscribe, tweakState.get);
  const [error, setError] = useState<string | null>(null);

  const save = useCallback(
    (patch: Partial<Tweaks>) => {
      setError(null);
      rpc.call("setTweaks", patch).then(
        (saved) => tweakState.set(saved),
        (cause: unknown) => setError(`Couldn't save: ${cause instanceof Error ? cause.message : String(cause)}`),
      );
    },
    [rpc],
  );

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3.5">
      <div className="space-y-5">
        <SettingsRow label="Text size" description="Size of the transcript and composer text.">
          <SegmentedControl
            label="Text size"
            segments={TEXT_SIZE_SEGMENTS}
            value={tweaks?.textSize ?? null}
            onChange={(textSize) => save({ textSize })}
          />
        </SettingsRow>
        <SettingsRow label="Transcript width" description="Maximum width of the transcript and composer columns.">
          <SegmentedControl
            label="Transcript width"
            segments={WIDTH_SEGMENTS}
            value={tweaks?.width ?? null}
            onChange={(width) => save({ width })}
          />
        </SettingsRow>
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** bb's settings row: label and description on the left, the control on the right. */
function SettingsRow({ label, description, children }: { label: string; description: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5 sm:flex-row sm:items-start sm:justify-between sm:gap-5">
      <div className="min-w-0 flex-1">
        <p className="min-w-0 text-sm font-normal text-foreground">{label}</p>
        <p className="mt-0.5 text-xs leading-snug text-subtle-foreground/75">{description}</p>
      </div>
      <div className="shrink-0 sm:flex sm:justify-end">{children}</div>
    </div>
  );
}

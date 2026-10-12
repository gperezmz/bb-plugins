import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { intervalProblem, parseSeconds, secondsText } from "./model";

/** One fleet's poll interval in seconds, with a reset to the default. The field refuses under 30 seconds before anything is sent. */
export function IntervalRow({
  repo,
  intervalMs,
  isDefault,
  onSet,
}: {
  repo: string;
  intervalMs: number;
  isDefault: boolean;
  /** Sends the interval (null for the default); resolves with the server's refusal, or null. */
  onSet(seconds: number | null): Promise<string | null>;
}) {
  const id = useId();
  const [text, setText] = useState(secondsText(intervalMs));
  const [refusal, setRefusal] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const problem = intervalProblem(text);
  const shown = refusal ?? (text !== secondsText(intervalMs) ? problem : null);

  async function set(seconds: number | null): Promise<void> {
    setSaving(true);
    const reason = await onSet(seconds);
    setSaving(false);
    setRefusal(reason);
  }

  return (
    <li className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={id} className="min-w-40 text-sm">
          {repo}
        </label>
        <Input
          id={id}
          inputMode="numeric"
          aria-label={`Poll interval of ${repo}, in seconds`}
          className="h-8 w-24"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setRefusal(null);
          }}
        />
        <span className="text-xs text-muted-foreground">seconds{isDefault ? " (default)" : ""}</span>
        <Button type="button" size="sm" variant="outline" aria-label={`Set the poll interval of ${repo}`} disabled={saving || problem !== null || parseSeconds(text) === intervalMs / 1000} onClick={() => void set(parseSeconds(text))}>
          Set
        </Button>
        <Button type="button" size="sm" variant="ghost" aria-label={`Reset the poll interval of ${repo} to the default`} disabled={saving || isDefault} onClick={() => void set(null)}>
          Default
        </Button>
      </div>
      {shown !== null ? (
        <p role="alert" className="text-xs text-destructive">
          {shown}
        </p>
      ) : null}
    </li>
  );
}

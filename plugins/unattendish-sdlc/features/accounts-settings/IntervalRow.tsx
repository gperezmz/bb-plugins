import { useId, useState } from "react";
import type { ForgeService } from "@/src/fleet/application/views";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ServiceLogo } from "@/shared/look/Glyph";
import { intervalProblem, parseSeconds, secondsText } from "./model";

/** One fleet's row of the poll interval table, in seconds, with a reset to the default. The field refuses under 30 seconds before anything is sent. */
export function IntervalRow({
  repo,
  forge,
  intervalMs,
  isDefault,
  onSet,
}: {
  repo: string;
  forge: ForgeService;
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
    <tr className="border-b border-border/60 align-top last:border-b-0">
      <th scope="row" className="py-2 pr-3 text-left font-normal">
        <label htmlFor={id} className="flex h-8 items-center gap-2">
          <ServiceLogo service={forge} />
          {repo}
        </label>
      </th>
      <td className="py-2 pr-3">
        <div className="flex items-center gap-2">
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
          <span className="whitespace-nowrap text-xs text-muted-foreground">seconds{isDefault ? " (default)" : ""}</span>
        </div>
        {shown !== null ? (
          <p role="alert" className="mt-1 text-xs text-destructive-text">
            {shown}
          </p>
        ) : null}
      </td>
      <td className="py-2">
        <div className="flex justify-end gap-2">
          <Button type="button" size="sm" variant="outline" aria-label={`Set the poll interval of ${repo}`} disabled={saving || problem !== null || parseSeconds(text) === intervalMs / 1000} onClick={() => void set(parseSeconds(text))}>
            Set
          </Button>
          <Button type="button" size="sm" variant="ghost" aria-label={`Reset the poll interval of ${repo} to the default`} disabled={saving || isDefault} onClick={() => void set(null)}>
            Default
          </Button>
        </div>
      </td>
    </tr>
  );
}

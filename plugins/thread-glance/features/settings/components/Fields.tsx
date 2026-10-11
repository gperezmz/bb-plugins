// The controls of the settings page, laid out like a row of bb's own settings:
// label and description on the left, the control on the right, an inline error
// under it.
import { useId, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function Group({ id, title, children }: { id: string; title: string; children?: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-title`} id={id} className="scroll-mt-14 rounded-lg border border-border bg-card px-4 py-3.5">
      <h3 id={`${id}-title`} className="mb-3 text-sm font-medium text-foreground">
        {title}
      </h3>
      <div className="space-y-5">{children}</div>
    </section>
  );
}

interface RowProps {
  label: string;
  description?: ReactNode;
  experimental?: boolean;
  error?: string;
  /** The id of the control the label names, for a control that is not the row's own. */
  labelFor?: string;
  children: ReactNode;
}

export function Row({ label, description, experimental, error, labelFor, children }: RowProps) {
  return (
    <div className="flex flex-col gap-2.5 sm:flex-row sm:items-start sm:justify-between sm:gap-5">
      <div className="min-w-0 flex-1">
        <p className="min-w-0 text-sm font-normal text-foreground">
          <label htmlFor={labelFor}>{label}</label>
          {experimental ? <span className="ml-2 rounded-sm bg-state-hover px-1.5 py-0.5 text-[10px] text-subtle-foreground">Experimental</span> : null}
        </p>
        {/* A div, not a p: a description can hold a list, which a p cannot. */}
        {description !== undefined ? <div className="mt-0.5 text-xs leading-snug text-subtle-foreground/75">{description}</div> : null}
        {error !== undefined ? (
          <p role="alert" className="mt-1 text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>
      <div className="shrink-0 sm:flex sm:justify-end">{children}</div>
    </div>
  );
}

export function SwitchRow(props: Omit<RowProps, "children" | "labelFor"> & { checked: boolean; onChange(checked: boolean): void }) {
  const { checked, onChange, ...row } = props;
  return (
    <Row {...row}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={row.label}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-input transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          checked ? "bg-foreground" : "bg-transparent",
        )}
      >
        <span className={cn("block size-3.5 rounded-full transition-transform", checked ? "translate-x-4 bg-background" : "translate-x-0.5 bg-muted-foreground")} />
      </button>
    </Row>
  );
}

export function NumberRow(props: Omit<RowProps, "children" | "labelFor"> & { value: string; min: number; max: number; onChange(typed: string): void }) {
  const { value, min, max, onChange, ...row } = props;
  const id = useId();
  return (
    <Row {...row} labelFor={id}>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        value={value}
        aria-invalid={row.error !== undefined}
        onChange={(event) => onChange(event.target.value)}
        className="w-24"
      />
    </Row>
  );
}

export function SelectRow<T extends string>(
  props: Omit<RowProps, "children" | "labelFor"> & { value: T; choices: readonly { value: T; label: string }[]; onChange(value: T): void },
) {
  const { value, choices, onChange, ...row } = props;
  const id = useId();
  return (
    <Row {...row} labelFor={id}>
      <Select id={id} value={value} choices={choices} onChange={onChange} />
    </Row>
  );
}

/** A native select drawn like bb's inputs. */
export function Select<T extends string>({
  id,
  label,
  value,
  choices,
  onChange,
}: {
  id?: string;
  label?: string;
  value: T;
  choices: readonly { value: T; label: string }[];
  onChange(value: T): void;
}) {
  return (
    <select
      id={id}
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value as T)}
      className="h-9 min-w-40 rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      {choices.map((choice) => (
        <option key={choice.value} value={choice.value}>
          {choice.label}
        </option>
      ))}
    </select>
  );
}

import { useId, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AUTH_CHOICES, formProblem, SERVICE_CHOICES, type Auth, type Form } from "./model";

const SELECT_CLASS =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring max-md:pointer-coarse:h-11 max-md:pointer-coarse:text-base";

/**
 * Adds or edits one credential. The token field is write-only: the stored token is never shown, and blank keeps it.
 * The field is uncontrolled, so what is typed never becomes an attribute of the page; it is read when the form is sent,
 * and the field is cleared when the form is sent or cancelled.
 */
export function CredentialForm({
  form,
  onChange,
  onSave,
  onCancel,
  saving,
  refusal,
}: {
  form: Form;
  onChange(form: Form): void;
  /** Sends the form with the token read from its field. */
  onSave(token: string): void;
  onCancel(): void;
  saving: boolean;
  refusal: string | null;
}) {
  const tokenField = useRef<HTMLInputElement>(null);
  const takeToken = (): string => {
    const token = tokenField.current?.value ?? "";
    if (tokenField.current !== null) tokenField.current.value = "";
    return token;
  };
  const ids = { prefix: useId(), auth: useId(), service: useId(), baseUrl: useId(), token: useId() };
  const problem = formProblem(form);
  const editing = form.was !== null;
  return (
    <form
      aria-label={editing ? `Edit ${form.was}` : "Add a credential"}
      className="flex flex-col gap-3 rounded-md border border-border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (problem === null && !saving) onSave(takeToken());
      }}
    >
      <Field id={ids.prefix} label="Prefix">
        <Input id={ids.prefix} value={form.prefix} placeholder="github.com/acme/web" onChange={(event) => onChange({ ...form, prefix: event.target.value })} />
      </Field>
      <Field id={ids.auth} label="Kind">
        <select id={ids.auth} className={SELECT_CLASS} value={form.auth} onChange={(event) => onChange({ ...form, auth: event.target.value as Auth, tokenTyped: false })}>
          {AUTH_CHOICES.map((choice) => (
            <option key={choice.id} value={choice.id}>
              {choice.label}
            </option>
          ))}
        </select>
      </Field>
      <Field id={ids.service} label="Service">
        <select id={ids.service} className={SELECT_CLASS} value={form.service} onChange={(event) => onChange({ ...form, service: event.target.value })}>
          {SERVICE_CHOICES.map((service) => (
            <option key={service} value={service}>
              {service === "" ? "from the prefix" : service}
            </option>
          ))}
        </select>
      </Field>
      <Field id={ids.baseUrl} label="API URL (optional)">
        <Input id={ids.baseUrl} value={form.baseUrl} placeholder="the service's default" onChange={(event) => onChange({ ...form, baseUrl: event.target.value })} />
      </Field>
      {form.auth === "token" ? (
        <Field id={ids.token} label="Token" hint={editing ? "Leave blank to keep the stored token." : undefined}>
          <Input
            id={ids.token}
            ref={tokenField}
            type="password"
            autoComplete="new-password"
            onChange={(event) => {
              const typed = event.target.value.trim() !== "";
              if (typed !== form.tokenTyped) onChange({ ...form, tokenTyped: typed });
            }}
          />
        </Field>
      ) : null}
      {refusal !== null ? (
        <p role="alert" className="text-sm text-destructive">
          {refusal}
        </p>
      ) : null}
      <div className="flex items-center justify-end gap-2">
        {problem !== null ? <span className="mr-auto text-xs text-muted-foreground">{problem}</span> : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            takeToken();
            onCancel();
          }}
        >
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={problem !== null || saving}>
          {editing ? "Save" : "Add"}
        </Button>
      </div>
    </form>
  );
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium">
        {label}
      </label>
      {children}
      {hint !== undefined ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

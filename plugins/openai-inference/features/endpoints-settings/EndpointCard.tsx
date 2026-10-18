import { useId, useRef, useState } from "react";
import type { Endpoint } from "@/src/endpoints";
import type { EndpointsApi } from "./client";
import { messageOf } from "./client";
import { Button, TextField } from "./controls";
import { blankForm, clearsKey, draftOf, formOf, isEdited, removeQuestion, showsKeySet, type Form, type KeyKind } from "./model";

type FieldErrors = Partial<Record<"id" | "url" | "model" | "key", string>>;

const KEY_KINDS: ReadonlyArray<{ kind: KeyKind; label: string }> = [
  { kind: "none", label: "None" },
  { kind: "variable", label: "Variable" },
  { kind: "literal", label: "Literal" },
];

/**
 * One Endpoint as a card, or the card for a new one (`saved` null). The card holds what is typed until Save sends it; Cancel puts the card back as saved, or, for a new card, discards it.
 *
 * `onChanged` receives the Endpoints now saved; the parent draws this card again from them, which is what clears what was typed.
 */
export function EndpointCard({
  saved,
  api,
  onChanged,
  onDiscard,
}: {
  saved: Endpoint | null;
  api: EndpointsApi;
  onChanged(endpoints: Endpoint[]): void;
  onDiscard(): void;
}) {
  const [form, setForm] = useState<Form>(() => (saved === null ? blankForm() : formOf(saved)));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);
  const literalField = useRef<HTMLInputElement>(null);
  const base = useId();
  const field = (name: string) => `${base}-${name}`;

  const edited = isEdited(form, saved);
  const change = (patch: Partial<Form>, field?: keyof FieldErrors) => {
    setForm((was) => ({ ...was, ...patch }));
    if (field !== undefined) setErrors((was) => ({ ...was, [field]: undefined }));
  };

  async function run(call: () => ReturnType<EndpointsApi["save"]>) {
    setBusy(true);
    setFailure(null);
    try {
      const result = await call();
      if (result.ok) {
        onChanged(result.endpoints);
        return;
      }
      if ("fields" in result) setErrors(result.fields);
      else setFailure(result.problem);
    } catch (error) {
      // The edits stay, so the same Save can be tried again.
      setFailure(messageOf(error));
    }
    setBusy(false);
  }

  const cancel = () => {
    if (saved === null) return onDiscard();
    setForm(formOf(saved));
    setErrors({});
    setFailure(null);
  };

  const heading = saved?.id ?? "New Endpoint";
  const keySet = showsKeySet(form, saved);
  return (
    <li aria-label={heading} className="flex flex-col gap-3 rounded-lg border border-border p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          id={field("id")}
          label="ID"
          value={form.id}
          readOnly={saved !== null}
          autoComplete="off"
          spellCheck={false}
          error={errors.id}
          hint={saved === null ? "Lowercase letters, digits and dashes. It cannot be changed once saved." : undefined}
          onChange={(event) => change({ id: event.target.value }, "id")}
        />
        <TextField
          id={field("model")}
          label="Model"
          value={form.model}
          autoComplete="off"
          spellCheck={false}
          error={errors.model}
          hint={saved !== null && saved.model === null && form.model === "" ? "Enter the model this server answers with." : undefined}
          onChange={(event) => change({ model: event.target.value }, "model")}
        />
      </div>
      <TextField
        id={field("url")}
        label="URL"
        value={form.url}
        autoComplete="off"
        spellCheck={false}
        placeholder="http://127.0.0.1:8080/v1"
        error={errors.url}
        onChange={(event) => change({ url: event.target.value }, "url")}
      />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-xs font-medium text-muted-foreground">Key</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {KEY_KINDS.map(({ kind, label }) => (
            <label key={kind} className="flex cursor-pointer items-center gap-1.5 text-sm">
              <input type="radio" name={field("key-kind")} checked={form.keyKind === kind} onChange={() => change({ keyKind: kind }, "key")} />
              {label}
            </label>
          ))}
        </div>
        {form.keyKind === "variable" ? (
          <TextField
            id={field("variable")}
            label="Key variable"
            value={form.variable}
            autoComplete="off"
            spellCheck={false}
            placeholder="${NAME}"
            error={errors.key}
            hint="A variable in bb's environment."
            onChange={(event) => change({ variable: event.target.value }, "key")}
          />
        ) : null}
        {form.keyKind === "literal" && keySet ? (
          <div className="flex items-center gap-2 text-sm">
            <span>Key set</span>
            <Button
              aria-label={`Replace the key of ${heading}`}
              onClick={() => {
                change({ replacing: true, literal: "" });
                // The field appears with this render.
                setTimeout(() => literalField.current?.focus(), 0);
              }}
            >
              Replace
            </Button>
          </div>
        ) : null}
        {form.keyKind === "literal" && !keySet ? (
          <TextField
            ref={literalField}
            id={field("literal")}
            label="Literal key"
            type="password"
            value={form.literal}
            autoComplete="off"
            spellCheck={false}
            error={errors.key}
            hint={saved?.key.kind === "literal" && !saved.key.set ? "Key not set: type it to use this Endpoint." : undefined}
            onChange={(event) => change({ literal: event.target.value }, "key")}
          />
        ) : null}
        {clearsKey(form, saved) ? (
          <p role="status" className="text-xs text-muted-foreground">
            Changing the URL clears the saved key: type it again after saving.
          </p>
        ) : null}
      </fieldset>
      {failure !== null ? (
        <p role="alert" className="text-sm text-destructive-text">
          {failure}
        </p>
      ) : null}
      {removing && saved !== null ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>{removeQuestion(saved.id)}</span>
          <Button variant="destructive" aria-label={`Confirm removing ${saved.id}`} disabled={busy} onClick={() => void run(() => api.remove(saved.id))}>
            Remove
          </Button>
          <Button variant="ghost" onClick={() => setRemoving(false)}>
            Keep
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {edited ? (
            <>
              <Button variant="default" disabled={busy} onClick={() => void run(() => api.save(draftOf(form), saved === null))}>
                Save
              </Button>
              <Button variant="ghost" disabled={busy} onClick={cancel}>
                Cancel
              </Button>
            </>
          ) : null}
          {saved !== null ? (
            <Button variant="ghost" className="ml-auto text-destructive-text" aria-label={`Remove ${saved.id}`} onClick={() => setRemoving(true)}>
              Remove
            </Button>
          ) : null}
        </div>
      )}
    </li>
  );
}

import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Choice, Field } from "./Field";
import { placeLabel, SERVICE_NAMES, SERVICES, setupFields, setupProblem, withService, type Setup } from "./model";
import type { ConnectRequest } from "./requests";

/** Add account's first question: the service, its host or Jira site, and for GitHub the owner the token is for. */
export function SetupStep({ request, setup, busy, problem, onChange, onContinue }: { request: ConnectRequest; setup: Setup; busy: boolean; problem: string | null; onChange(setup: Setup): void; onContinue(): void }) {
  const ids = { place: useId(), owner: useId() };
  const fields = setupFields(request, setup);
  const missing = setupProblem(request, setup);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (missing === null && !busy) onContinue();
      }}
    >
      {fields.service ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-xs font-medium">Service</legend>
          {SERVICES.map((service) => (
            <Choice key={service} name="service" value={service} label={SERVICE_NAMES[service]} checked={setup.service === service} onChange={() => onChange(withService(setup, service))} />
          ))}
        </fieldset>
      ) : null}
      {fields.place ? (
        <Field id={ids.place} label={placeLabel(setup.service)} hint={setup.service === "jira" ? "A Jira Cloud site, such as acme.atlassian.net." : undefined}>
          <Input id={ids.place} value={setup.place} onChange={(event) => onChange({ ...setup, place: event.target.value })} />
        </Field>
      ) : null}
      {fields.owner ? (
        <Field id={ids.owner} label="Owner" hint="The organisation or user whose repositories the token is for.">
          <Input id={ids.owner} value={setup.owner} onChange={(event) => onChange({ ...setup, owner: event.target.value })} />
        </Field>
      ) : null}
      {problem !== null ? (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      ) : null}
      <div className="flex items-center justify-end gap-2">
        {missing !== null ? <span className="mr-auto text-xs text-muted-foreground">{missing}</span> : null}
        <Button type="submit" size="sm" disabled={missing !== null || busy}>
          Continue
        </Button>
      </div>
    </form>
  );
}

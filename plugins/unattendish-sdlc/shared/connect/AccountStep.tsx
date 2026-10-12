import { useState } from "react";
import type { ConnectView } from "@/src/fleet/application/views";
import { Button } from "@/components/ui/button";
import { CanWrite, Choice } from "./Field";
import { asksService, choiceFor, initialOption, newLoginService, NEW_LOGIN, SERVICE_NAMES, type Service } from "./model";

const CHOOSABLE: readonly Service[] = ["github", "gitlab"];

/** Step 1: which account reads the half: those on its host, the default first, or a new login. */
export function AccountStep({ view, chosenService, busy, onService, onChoose }: { view: ConnectView; chosenService: Service | null; busy: boolean; onService(service: Service): void; onChoose(option: string): void }) {
  const [option, setOption] = useState(() => initialOption(view));
  const service = newLoginService(view, chosenService);
  const subject = view.scope ?? view.what ?? view.place;
  const ready = choiceFor(view, option, chosenService) !== null;
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready && !busy) onChoose(option);
      }}
    >
      {asksService(view, chosenService) ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-xs font-medium">{view.place} is which service?</legend>
          {CHOOSABLE.map((candidate) => (
            <Choice key={candidate} name="host-service" value={candidate} label={SERVICE_NAMES[candidate]} checked={false} onChange={() => onService(candidate)} />
          ))}
        </fieldset>
      ) : (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-xs font-medium">Which account reads {subject}?</legend>
          {view.accounts.map((account) => (
            <Choice key={account.id} name="account" value={account.id} label={account.label} checked={option === account.id} onChange={() => setOption(account.id)}>
              <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                {account.isDefault ? <span>default</span> : null}
                {account.canWrite ? <CanWrite /> : null}
                {account.reaches ? <span>already reads this</span> : null}
              </span>
              {account.loginProblem !== null ? <span className="text-xs text-destructive">{account.loginProblem}</span> : null}
            </Choice>
          ))}
          <Choice name="account" value={NEW_LOGIN} label="a new login" checked={option === NEW_LOGIN} onChange={() => setOption(NEW_LOGIN)}>
            {service !== null ? <span className="text-xs text-muted-foreground">{SERVICE_NAMES[service]} on {view.place}</span> : null}
          </Choice>
        </fieldset>
      )}
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={!ready || busy}>
          Continue
        </Button>
      </div>
    </form>
  );
}

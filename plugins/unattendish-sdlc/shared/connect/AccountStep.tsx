import { useState, type ReactNode } from "react";
import type { ConnectView } from "@/src/fleet/application/views";
import { Button } from "@/components/ui/button";
import { Glyph, ServiceLogo } from "../look/Glyph";
import { ICONS } from "../look/icons";
import { Pill } from "../look/Pill";
import { CanWrite } from "./Field";
import { asksService, choiceFor, initialOption, newLoginService, NEW_LOGIN, SERVICE_NAMES, type Service } from "./model";
import { ServiceTiles } from "./ServiceTiles";

const CHOOSABLE: readonly Service[] = ["github", "gitlab"];

/**
 * Step 1: which account reads the half: those on its host, the default first, or a new login, each a card. Where the
 * host names no service, GitHub or GitLab is asked first, as tiles that stay to show the choice.
 */
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
      {view.service === null ? <ServiceTiles legend={`${view.place} is which service?`} name="host-service" services={CHOOSABLE} chosen={chosenService} onChoose={onService} /> : null}
      {asksService(view, chosenService) ? null : (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-xs font-medium">Which account reads {subject}?</legend>
          {view.accounts.map((account) => (
            <Card key={account.id} value={account.id} checked={option === account.id} onChange={() => setOption(account.id)}>
              <span className="flex flex-wrap items-center gap-1.5">
                {service !== null ? <ServiceLogo service={service} decorative /> : null}
                <span className="font-medium">{account.label}</span>
                {account.isDefault ? <Pill>default</Pill> : null}
                {account.canWrite ? <CanWrite /> : null}
                {account.reaches ? (
                  <Pill tone="green" icon={ICONS.done}>
                    already reads this
                  </Pill>
                ) : null}
              </span>
              {account.loginProblem !== null ? (
                <span className="flex items-start gap-1 text-xs text-destructive-text">
                  <Glyph name={ICONS.loginProblem} className="mt-px" />
                  {account.loginProblem}
                </span>
              ) : null}
            </Card>
          ))}
          <Card value={NEW_LOGIN} checked={option === NEW_LOGIN} onChange={() => setOption(NEW_LOGIN)}>
            <span className="flex items-center gap-1.5">
              <Glyph name={ICONS.newLogin} />
              <span className="font-medium">a new login</span>
            </span>
            {service !== null ? (
              <span className="text-xs text-muted-foreground">
                {SERVICE_NAMES[service]} on {view.place}
              </span>
            ) : null}
          </Card>
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

/** One account as a card with its radio button; the chosen card is outlined. */
function Card({ value, checked, onChange, children }: { value: string; checked: boolean; onChange(): void; children: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border p-2.5 hover:bg-state-hover has-[:checked]:border-foreground">
      <input type="radio" name="account" value={value} checked={checked} onChange={onChange} className="mt-0.5" />
      <span className="flex min-w-0 flex-col gap-1">{children}</span>
    </label>
  );
}

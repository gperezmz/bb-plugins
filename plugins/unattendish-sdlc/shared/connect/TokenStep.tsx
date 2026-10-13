import { useId, useRef, useState, type ReactNode } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { ConnectSecret, TokenPageView } from "@/src/fleet/application/views";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Glyph, ServiceLogo } from "../look/Glyph";
import { ICONS } from "../look/icons";
import { Field } from "./Field";
import { defaultLogin, loginTool, secretFor, secretLabel, secretNoun, secretProblem, sentToText, SERVICE_NAMES, signInText, type AccountChoice, type Method, type Service } from "./model";

/**
 * Step 2: a token, key or login for the account, in two parts: creating the token, where the service has a page
 * for it, and giving it to the plugin. The secret's field is uncontrolled, so what is typed never
 * becomes state or an attribute of the page: it is read when the form is sent, and the field is cleared then.
 */
export function TokenStep({
  service,
  choice,
  page,
  logins,
  busy,
  onVerify,
  onBack,
}: {
  service: Service;
  choice: AccountChoice;
  page: TokenPageView;
  logins: readonly string[];
  busy: boolean;
  onVerify(secret: ConnectSecret): void;
  /** Back to the account step, where the popup may go there. */
  onBack?: () => void;
}) {
  const navigate = useBbNavigate();
  const ids = { email: useId(), token: useId(), login: useId() };
  const field = useRef<HTMLInputElement>(null);
  const tool = loginTool(service);
  const label = choice.kind === "existing" ? choice.label : `a new ${SERVICE_NAMES[service]} login`;
  const [method, setMethod] = useState<Method>("paste");
  const [email, setEmail] = useState("");
  const [typed, setTyped] = useState(false);
  const [login, setLogin] = useState(() => defaultLogin(logins, choice.kind === "existing" ? choice.label : null));
  const fields = { method, email, typed, login };
  const problem = secretProblem(service, fields);
  const noun = secretNoun(service);

  const take = (): string => {
    const text = field.current?.value ?? "";
    if (field.current !== null) field.current.value = "";
    setTyped(false);
    return text;
  };

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (problem === null && !busy) onVerify(secretFor(service, fields, method === "paste" ? take() : ""));
      }}
    >
      <p className="text-xs text-muted-foreground">Connecting {label}.</p>
      {page.url !== null ? (
        <Part number={1} title={`Create a ${noun}`}>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" size="sm" variant="outline" onClick={() => navigate.openUrl(page.url as string)}>
              <ServiceLogo service={service} decorative />
              Create token
              <Glyph name={ICONS.openPage} />
            </Button>
            <span className="text-xs text-muted-foreground">Opens {SERVICE_NAMES[service]} in your browser, filled in.</span>
          </div>
          <p className="text-xs">{signInText(page)}</p>
          {page.grants.length > 0 ? (
            <div className="flex flex-col gap-1 text-xs">
              <p className="font-medium">Grants, if the form does not come filled in:</p>
              <ul aria-label="Grants" className="flex flex-wrap gap-1">
                {page.grants.map((grant) => (
                  <li key={grant} className="rounded border border-border bg-secondary px-1.5 py-px font-mono text-[11px]">
                    {grant}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {page.repositories.length > 0 ? (
            <div className="flex flex-col gap-1 text-xs">
              <p className="font-medium">Tick these repositories:</p>
              <ul aria-label="Repositories to tick" className="flex flex-col gap-0.5">
                {page.repositories.map((repository) => (
                  <li key={repository} className="flex items-center gap-1.5">
                    <Glyph name={ICONS.done} className="size-3 text-muted-foreground" />
                    {repository}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {page.chooseExpiry ? <p className="text-xs">{SERVICE_NAMES[service]} cannot pre-fill the expiry: choose it on the page.</p> : null}
          {page.note !== null ? <p className="text-xs text-warning-text">{page.note}</p> : null}
        </Part>
      ) : null}
      <Part number={page.url !== null ? 2 : null} title="Give it to the plugin">
        {tool !== null ? (
          <fieldset className="flex flex-col gap-1.5">
            <legend className="sr-only">Credential</legend>
            <div className="inline-flex w-fit rounded-md border border-border p-0.5 text-xs">
              <Segment value="paste" label={`Paste a ${noun}`} checked={method === "paste"} onChange={() => setMethod("paste")} />
              <Segment value="login" label={`Use your ${tool} login`} checked={method === "login"} disabled={logins.length === 0} onChange={() => setMethod("login")} />
            </div>
            <span className="text-xs text-muted-foreground">{logins.length === 0 ? `${tool} holds no login for this host.` : `${tool} can write wherever its login can; the plugin reads only.`}</span>
          </fieldset>
        ) : null}
        {method === "paste" ? (
          <div className="flex flex-col gap-3">
            {service === "jira" ? (
              <Field id={ids.email} label="Email">
                <Input id={ids.email} type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
              </Field>
            ) : null}
            <Field id={ids.token} label={secretLabel(service)}>
              <Input id={ids.token} ref={field} type="password" autoComplete="new-password" onChange={(event) => setTyped(event.target.value.trim() !== "")} />
            </Field>
          </div>
        ) : (
          <Field id={ids.login} label={`${tool} login`}>
            <select id={ids.login} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm" value={login} onChange={(event) => setLogin(event.target.value)}>
              {logins.map((candidate) => (
                <option key={candidate} value={candidate}>
                  {candidate}
                </option>
              ))}
            </select>
          </Field>
        )}
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Glyph name={ICONS.sentOnlyTo} />
          {sentToText(service, page, method)}
        </p>
      </Part>
      <div className="flex items-center justify-end gap-2">
        {onBack !== undefined ? (
          <Button type="button" size="sm" variant="ghost" className="mr-auto" onClick={onBack}>
            <Glyph name={ICONS.back} />
            Back
          </Button>
        ) : null}
        {problem !== null ? <span className="text-xs text-muted-foreground">{problem}</span> : null}
        <Button type="submit" size="sm" disabled={problem !== null || busy}>
          <Glyph name={ICONS.verify} />
          Verify and save
        </Button>
      </div>
    </form>
  );
}

/** One numbered part of the step; a part alone goes unnumbered. */
function Part({ number, title, children }: { number: number | null; title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2.5 rounded-md border border-border p-3">
      <h3 className="flex items-center gap-2 text-sm font-medium">
        {number !== null ? (
          <span aria-hidden className="flex size-5 items-center justify-center rounded-full bg-foreground text-xs tabular-nums text-background">
            {number}
          </span>
        ) : null}
        {title}
      </h3>
      {children}
    </section>
  );
}

/** One side of the two-way switch: a radio button drawn as a segment, solid while chosen. */
function Segment({ value, label, checked, disabled = false, onChange }: { value: Method; label: string; checked: boolean; disabled?: boolean; onChange(): void }) {
  return (
    <label className="cursor-pointer rounded px-2.5 py-1 has-[:checked]:bg-foreground has-[:checked]:text-background has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50 has-[:focus-visible]:ring-1 has-[:focus-visible]:ring-ring">
      <input type="radio" name="method" value={value} checked={checked} disabled={disabled} onChange={onChange} className="sr-only" />
      {label}
    </label>
  );
}

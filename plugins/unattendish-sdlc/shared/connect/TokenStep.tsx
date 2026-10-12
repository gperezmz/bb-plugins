import { useId, useRef, useState } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { ConnectSecret, TokenPageView } from "@/src/fleet/application/views";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Choice, Field } from "./Field";
import { defaultLogin, loginTool, secretFor, secretLabel, secretNoun, secretProblem, sentToText, SERVICE_NAMES, signInText, type AccountChoice, type Method, type Service } from "./model";

/**
 * Step 2: a token, key or login for the account. The secret's field is uncontrolled, so what is typed never
 * becomes state or an attribute of the page: it is read when the form is sent, and the field is cleared then.
 */
export function TokenStep({
  service,
  choice,
  page,
  logins,
  busy,
  onVerify,
}: {
  service: Service;
  choice: AccountChoice;
  page: TokenPageView;
  logins: readonly string[];
  busy: boolean;
  onVerify(secret: ConnectSecret): void;
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
        <section aria-label="Create token" className="flex flex-col gap-2 rounded-md border border-border p-3">
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" size="sm" variant="outline" onClick={() => navigate.openUrl(page.url as string)}>
              Create token
            </Button>
            <span className="text-xs text-muted-foreground">Opens {SERVICE_NAMES[service]} in your browser, filled in.</span>
          </div>
          <p className="text-xs">{signInText(page)}</p>
          {page.grants.length > 0 ? (
            <div className="text-xs">
              <p className="font-medium">Grants, if the form does not come filled in:</p>
              <ul aria-label="Grants" className="list-disc pl-5">
                {page.grants.map((grant) => (
                  <li key={grant}>{grant}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {page.chooseExpiry ? <p className="text-xs">{SERVICE_NAMES[service]} cannot pre-fill the expiry: choose it on the page.</p> : null}
          {page.repositories.length > 0 ? (
            <div className="text-xs">
              <p className="font-medium">Tick these repositories:</p>
              <ul aria-label="Repositories to tick" className="list-disc pl-5">
                {page.repositories.map((repository) => (
                  <li key={repository}>{repository}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {page.note !== null ? <p className="text-xs text-warning">{page.note}</p> : null}
        </section>
      ) : null}
      {tool !== null ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-xs font-medium">Credential</legend>
          <Choice name="method" value="paste" label={`Paste a ${noun}`} checked={method === "paste"} onChange={() => setMethod("paste")} />
          <Choice name="method" value="login" label={`Use your ${tool} login`} checked={method === "login"} disabled={logins.length === 0} onChange={() => setMethod("login")}>
            <span className="text-xs text-muted-foreground">
              {logins.length === 0 ? `${tool} holds no login for this host.` : `${tool} can write wherever its login can; the plugin reads only.`}
            </span>
          </Choice>
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
      <p className="text-xs text-muted-foreground">{method === "paste" ? sentToText(service, page) : `The ${tool} login's token will be sent to ${page.sentTo}, and to nowhere else.`}</p>
      <div className="flex items-center justify-end gap-2">
        {problem !== null ? <span className="mr-auto text-xs text-muted-foreground">{problem}</span> : null}
        <Button type="submit" size="sm" disabled={problem !== null || busy}>
          Verify and save
        </Button>
      </div>
    </form>
  );
}

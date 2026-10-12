import type { AccountSettingView, CredentialSettingView } from "@/src/fleet/application/views";
import { Button } from "@/components/ui/button";
import { CanWrite } from "@/shared/connect/Field";
import { openConnect } from "@/shared/connect/requests";
import { addTokenRequest, defaultText, expiryText, expiryWarning, renewOffer, usedByText } from "./model";
import type { AccountActions } from "./use-account-actions";

/** One account: where it is the default, its credentials with what they reach, and the owners assigned to it. */
export function AccountItem({ account, actions }: { account: AccountSettingView; actions: AccountActions }) {
  const standsDefault = defaultText(account);
  const confirming = actions.asked?.kind === "account" && actions.asked.id === account.id;
  return (
    <li aria-label={account.label} className="flex flex-col gap-2 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <span className="font-medium">{account.label}</span>
        <span className="text-muted-foreground">{account.place}</span>
        {account.canWrite ? <CanWrite /> : null}
        {standsDefault !== null ? <span className="text-muted-foreground">{standsDefault}</span> : null}
        {account.canMakeDefault ? (
          <Button type="button" size="sm" variant="outline" aria-label={`Make ${account.label} the default`} onClick={() => void actions.makeDefault(account.id)}>
            Make default
          </Button>
        ) : null}
      </div>
      {account.loginProblem !== null ? <p className="text-xs text-destructive">{account.loginProblem}</p> : null}
      {account.credentials.length > 0 ? (
        <ul aria-label={`Credentials of ${account.label}`} className="flex flex-col gap-1">
          {account.credentials.map((credential) => (
            <Credential key={credential.id} account={account} credential={credential} actions={actions} />
          ))}
        </ul>
      ) : null}
      {account.assignments.length > 0 ? (
        <ul aria-label={`Assigned to ${account.label}`} className="flex flex-col gap-1">
          {account.assignments.map((assignment) => (
            <li key={assignment.scope} className="flex flex-wrap items-center gap-x-3 text-xs">
              <span>{assignment.what}</span>
              <Button type="button" size="sm" variant="ghost" aria-label={`Remove ${assignment.what} from ${account.label}`} onClick={() => void actions.removeAssignment(assignment.scope)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {confirming ? (
        <Confirm text={`Remove ${account.label} and all its tokens?`} label={`Confirm removing ${account.label}`} onRemove={() => void actions.removeAccount(account.id)} onKeep={() => actions.ask(null)} />
      ) : (
        <div className="flex flex-wrap gap-2">
          {account.addsOwners ? (
            <Button type="button" size="sm" variant="outline" aria-label={`Add token for another owner to ${account.label}`} onClick={() => openConnect(addTokenRequest(account))}>
              Add token for another owner
            </Button>
          ) : null}
          <Button type="button" size="sm" variant="outline" aria-label={`Remove ${account.label}`} onClick={() => actions.ask({ kind: "account", id: account.id })}>
            Remove
          </Button>
        </div>
      )}
    </li>
  );
}

function Credential({ account, credential, actions }: { account: AccountSettingView; credential: CredentialSettingView; actions: AccountActions }) {
  const warning = expiryWarning(credential);
  const offer = renewOffer(account, credential);
  const confirming = actions.asked?.kind === "credential" && actions.asked.id === credential.id;
  return (
    <li className="flex flex-col gap-1 rounded border border-border/60 p-2">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <span className="font-medium">{credential.reaches}</span>
        <span className="text-muted-foreground">{credential.kindLabel}</span>
        {credential.canWrite ? <CanWrite /> : null}
        <span className={credential.refused ? "text-destructive" : "text-muted-foreground"}>{expiryText(credential)}</span>
        <span className="text-muted-foreground">{usedByText(credential)}</span>
      </div>
      {warning !== null ? <p className={warning.tone === "destructive" ? "text-xs text-destructive" : "text-xs text-warning"}>{warning.text}</p> : null}
      {offer?.kind === "command" ? (
        <p className="text-xs">
          Sign in again as the account's login: <code className="rounded bg-secondary px-1">{offer.command}</code>
        </p>
      ) : null}
      {confirming ? (
        <Confirm text={`Remove the token for ${credential.reaches}?`} label={`Confirm removing the token for ${credential.reaches}`} onRemove={() => void actions.removeCredential(credential.id)} onKeep={() => actions.ask(null)} />
      ) : (
        <div className="flex gap-2">
          {offer?.kind === "popup" ? (
            <Button type="button" size="sm" variant="outline" aria-label={`Renew the token for ${credential.reaches} of ${account.label}`} onClick={() => openConnect(offer.request)}>
              Renew
            </Button>
          ) : null}
          <Button type="button" size="sm" variant="outline" aria-label={`Remove the token for ${credential.reaches} of ${account.label}`} onClick={() => actions.ask({ kind: "credential", id: credential.id })}>
            Remove
          </Button>
        </div>
      )}
    </li>
  );
}

function Confirm({ text, label, onRemove, onKeep }: { text: string; label: string; onRemove(): void; onKeep(): void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span>{text}</span>
      <Button type="button" size="sm" variant="destructive" aria-label={label} onClick={onRemove}>
        Remove
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onKeep}>
        Keep
      </Button>
    </div>
  );
}

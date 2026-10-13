import type { AccountSettingView, CredentialSettingView } from "@/src/fleet/application/views";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { CanWrite } from "@/shared/connect/Field";
import { openConnect } from "@/shared/connect/requests";
import { Glyph, ServiceLogo } from "@/shared/look/Glyph";
import { ICONS, SERVICE_LOGOS } from "@/shared/look/icons";
import { Pill } from "@/shared/look/Pill";
import { Tip } from "@/shared/look/Tip";
import { TONE_TEXT } from "@/shared/look/tones";
import { addTokenRequest, defaultText, expiryShown, renewOffer, sharesRateLimit, usedByText } from "./model";
import type { AccountActions } from "./use-account-actions";

/**
 * One account as a card: a header with its logo, label, place and default, and a ⋯ menu for what is done to it
 * rarely; a line per token; and the chips of what it is assigned to read.
 */
export function AccountItem({ account, actions }: { account: AccountSettingView; actions: AccountActions }) {
  const standsDefault = defaultText(account);
  const confirming = actions.asked?.kind === "account" && actions.asked.id === account.id;
  return (
    <li aria-label={account.label} className="flex flex-col gap-2.5 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {SERVICE_LOGOS[account.service] !== undefined ? <ServiceLogo service={account.service} decorative className="size-4" /> : null}
        <span className="font-medium">{account.label}</span>
        <span className="text-xs text-muted-foreground">{account.place}</span>
        {account.canWrite ? <CanWrite /> : null}
        {standsDefault !== null ? (
          <Tip text={standsDefault}>
            <span tabIndex={0} aria-label={standsDefault} className="rounded-full focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
              <Pill>default</Pill>
            </span>
          </Tip>
        ) : null}
        {account.canMakeDefault ? (
          <Button type="button" size="sm" variant="outline" className="h-7" aria-label={`Make ${account.label} the default`} onClick={() => void actions.makeDefault(account.id)}>
            Make default
          </Button>
        ) : null}
        {/* Not modal: a modal menu would still hold focus and pointer events as the Connect popup it opens takes them. */}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button type="button" size="icon" variant="ghost" className="ml-auto size-7" aria-label={`More for ${account.label}`}>
              <Glyph name={ICONS.more} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {account.addsOwners ? (
              <DropdownMenuItem aria-label={`Add token for another owner to ${account.label}`} onSelect={() => openConnect(addTokenRequest(account))}>
                <Glyph name={ICONS.newLogin} />
                Add token for another owner
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem aria-label={`Remove ${account.label}`} className={TONE_TEXT.red} onSelect={() => actions.ask({ kind: "account", id: account.id })}>
              <Glyph name={ICONS.removeToken} />
              Remove account
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {account.loginProblem !== null ? (
        <p className="flex items-start gap-1 text-xs text-destructive-text">
          <Glyph name={ICONS.loginProblem} className="mt-px" />
          {account.loginProblem}
        </p>
      ) : null}
      {account.credentials.length > 0 ? (
        <ul aria-label={`Credentials of ${account.label}`} className="flex flex-col gap-1.5">
          {account.credentials.map((credential) => (
            <Credential key={credential.id} account={account} credential={credential} actions={actions} />
          ))}
        </ul>
      ) : null}
      {account.assignments.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">Reads</span>
          <ul aria-label={`Assigned to ${account.label}`} className="flex flex-wrap gap-1.5">
            {account.assignments.map((assignment) => (
              <li key={assignment.scope} className="inline-flex items-center gap-0.5 rounded-full border border-border bg-secondary py-px pl-2 pr-0.5">
                {assignment.what}
                <button
                  type="button"
                  aria-label={`Remove ${assignment.what} from ${account.label}`}
                  className="flex size-4 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  onClick={() => void actions.removeAssignment(assignment.scope)}
                >
                  <Glyph name={ICONS.clear} className="size-3" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {confirming ? <Confirm text={`Remove ${account.label} and all its tokens?`} label={`Confirm removing ${account.label}`} onRemove={() => void actions.removeAccount(account.id)} onKeep={() => actions.ask(null)} /> : null}
    </li>
  );
}

/** One token as a line: what it reaches, its kind, who reads with it, its expiry by urgency, Renew… where due, and 🗑. */
function Credential({ account, credential, actions }: { account: AccountSettingView; credential: CredentialSettingView; actions: AccountActions }) {
  const expiry = expiryShown(credential);
  const offer = renewOffer(account, credential);
  const confirming = actions.asked?.kind === "credential" && actions.asked.id === credential.id;
  return (
    <li className="flex flex-col gap-1.5 rounded-md border border-border/60 px-2.5 py-1.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <Glyph name={ICONS.token} className="text-muted-foreground" />
        <span className="text-sm font-medium">{credential.reaches}</span>
        <span className="text-muted-foreground">{credential.kindLabel}</span>
        {credential.canWrite ? <CanWrite /> : null}
        <span className="text-muted-foreground">{usedByText(credential)}</span>
        {sharesRateLimit(credential) ? <span className={TONE_TEXT.amber}>shares the agents' rate limit</span> : null}
        <span className="ml-auto flex items-center gap-2">
          <span className={cn("flex items-center gap-1", TONE_TEXT[expiry.tone])}>
            {expiry.icon !== null ? <Glyph name={expiry.icon} /> : null}
            {expiry.text}
          </span>
          {offer?.kind === "popup" ? (
            <Button type="button" size="sm" variant="outline" className="h-7" aria-label={`Renew the token for ${credential.reaches} of ${account.label}`} onClick={() => openConnect(offer.request)}>
              Renew…
            </Button>
          ) : null}
          <Button type="button" size="icon" variant="ghost" className="size-7" aria-label={`Remove the token for ${credential.reaches} of ${account.label}`} onClick={() => actions.ask({ kind: "credential", id: credential.id })}>
            <Glyph name={ICONS.removeToken} />
          </Button>
        </span>
      </div>
      {offer?.kind === "command" ? (
        <p className="text-xs">
          Sign in again as the account's login: <code className="rounded bg-secondary px-1">{offer.command}</code>
        </p>
      ) : null}
      {confirming ? <Confirm text={`Remove the token for ${credential.reaches}?`} label={`Confirm removing the token for ${credential.reaches}`} onRemove={() => void actions.removeCredential(credential.id)} onKeep={() => actions.ask(null)} /> : null}
    </li>
  );
}

function Confirm({ text, label, onRemove, onKeep }: { text: string; label: string; onRemove(): void; onKeep(): void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
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

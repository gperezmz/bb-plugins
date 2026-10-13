import type { ReactNode } from "react";
import { UrlLink } from "@get-bb/plugin-sdk/app";
import type { FleetCredentialView, FleetDetailView } from "@/src/fleet/application/views";
import { cn } from "@/lib/utils";
import { openConnect } from "@/shared/connect/requests";
import { LINK_CLASS } from "@/shared/ItemLink";
import { Glyph, ServiceLogo } from "@/shared/look/Glyph";
import { ICONS } from "@/shared/look/icons";
import { Empty } from "./Fold";
import { credentialFacts, credentialService, pollingText, whyText } from "./model";

/** The Watching tab: the watched set, the credentials the fleet reads with, and its polling. */
export function Watching({ detail }: { detail: FleetDetailView }) {
  return (
    <div className="flex flex-col gap-4">
      <Block id="fleet-tab-watched" title="Watched set">
        {detail.watched.length === 0 ? (
          <Empty>Nothing is watched yet.</Empty>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {detail.watched.map((item) => (
              <li key={item.ref} className="flex flex-wrap items-baseline gap-x-3">
                {item.url !== null ? (
                  <UrlLink href={item.url} className={LINK_CLASS}>
                    {item.ref}
                  </UrlLink>
                ) : (
                  <span>{item.ref}</span>
                )}
                <span className="text-xs text-muted-foreground">{whyText(item)}</span>
              </li>
            ))}
          </ul>
        )}
      </Block>
      <Block id="fleet-tab-credentials" title="Credentials">
        {detail.credentials.length === 0 ? (
          <Empty>The fleet uses no credential.</Empty>
        ) : (
          <ul className="flex flex-col gap-2">
            {detail.credentials.map((credential) => (
              <Credential key={`${credential.role}:${credential.label}`} credential={credential} fleet={detail.card.repo} />
            ))}
          </ul>
        )}
      </Block>
      <Block id="fleet-tab-polling" title="Polling">
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <Glyph name={ICONS.late} />
          {pollingText(detail)}
        </p>
      </Block>
    </div>
  );
}

function Block({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h3 id={id} className="text-sm font-semibold">
        {title}
      </h3>
      {children}
    </section>
  );
}

/** A credential as a small card: the service's logo and the account, the half it reads, its kind and expiry, what to beware of, and Change account…. */
function Credential({ credential, fleet }: { credential: FleetCredentialView; fleet: string }) {
  return (
    <li aria-label={`Credential ${credential.label}`} className="flex flex-col gap-1 rounded-md border border-border p-2 text-xs">
      <div className="flex min-w-0 items-center gap-2">
        <ServiceLogo service={credentialService(credential.kind)} />
        <span className="min-w-0 truncate text-sm font-medium">{credential.account.label}</span>
        {credential.canWrite ? <span className="shrink-0 rounded bg-warning/15 px-1 text-warning-text">can write</span> : null}
        <button
          type="button"
          aria-label={`Change account… for the ${credential.role} of ${fleet}`}
          className={cn(LINK_CLASS, "ml-auto shrink-0")}
          onClick={() => openConnect({ target: { fleet, role: credential.role } })}
        >
          Change account…
        </button>
      </div>
      <div className="flex flex-wrap gap-x-2 text-muted-foreground">
        {credentialFacts(credential).map((fact) => (
          <span key={fact.text} className={cn(fact.red && "text-destructive-text")}>
            {fact.text}
          </span>
        ))}
      </div>
      {credential.sharesAgentRateLimit ? <div className="text-warning-text">shares the agents' rate limit</div> : null}
    </li>
  );
}

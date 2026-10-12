import { UrlLink } from "@get-bb/plugin-sdk/app";
import type { FleetDetailView } from "@/src/fleet/application/views";
import { intervalLabel, plural, polledLabel } from "@/shared/format";
import { Empty, Section } from "./Section";
import { credentialParts, watchedHeading, whyText } from "./model";

/** What the plugin watches for the fleet, how, and at what cost in requests. */
export function WatchingSections({ detail }: { detail: FleetDetailView }) {
  return (
    <>
      <Section id="tab-watched" title={watchedHeading(detail.watched.length)}>
        {detail.watched.length === 0 ? (
          <Empty>Nothing is watched yet.</Empty>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {detail.watched.map((item) => (
              <li key={item.ref} className="flex flex-wrap items-baseline gap-x-3">
                {item.url !== null ? (
                  <UrlLink href={item.url} className="text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground">
                    {item.ref}
                  </UrlLink>
                ) : (
                  <span>{item.ref}</span>
                )}
                <span className="text-muted-foreground">{whyText(item)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section id="tab-credentials" title="Credentials">
        {detail.credentials.length === 0 ? (
          <Empty>The fleet uses no credential.</Empty>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {detail.credentials.map((credential) => (
              <li key={`${credential.role}:${credential.prefix}`} className="flex flex-wrap items-baseline gap-x-3">
                <span>
                  {credential.role} <span className="font-medium">{credential.prefix}</span>
                </span>
                {credentialParts(credential).map((part) => (
                  <span key={part} className={part.startsWith("shares") ? "text-warning" : "text-muted-foreground"}>
                    {part}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section id="tab-polling" title="Polling">
        <p className="text-sm text-muted-foreground">
          {intervalLabel(detail.card.intervalMs)} · {polledLabel(detail.card.lastPolledAt, detail.generatedAt)} · {plural(detail.requestsThisHour, "request")} this hour
        </p>
      </Section>
    </>
  );
}

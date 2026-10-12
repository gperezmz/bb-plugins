import { Markdown } from "@get-bb/plugin-sdk/app";
import type { FleetDetailView } from "@/src/fleet/application/views";
import { dateTimeLabel } from "@/shared/format";
import { InboxTable } from "@/shared/inbox/InboxTable";
import { ItemLink, ThreadLink } from "@/shared/ItemLink";
import { Empty, Section } from "./Section";
import { blockedText, itemTitle, stageText, unreadableRowText } from "./model";

type Manifest = FleetDetailView["manifest"];

/** The whole manifest, rendered: the rows the plugin reads by column, then every section it keeps as written. */
export function ManifestSections({ manifest, managerThreadId, fleet, now, refetch }: { manifest: Manifest; managerThreadId: string; fleet: string; now: string; refetch: () => Promise<void> }) {
  if (manifest.status === "missing") return <Empty>No manifest was found at the path the fleet registered.</Empty>;
  if (manifest.status === "unreadable") return <Empty>{`The manifest cannot be read: ${manifest.reason}`}</Empty>;
  return (
    <>
      <Section id="tab-inbox" title="Waits on you">
        <InboxTable rows={manifest.inbox} unreadable={manifest.unreadableInbox} now={now} showFleet={false} refetch={refetch} />
      </Section>
      <Section id="tab-in-flight" title="In flight">
        {manifest.inFlight.length === 0 ? (
          <Empty>Nothing in flight</Empty>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {manifest.inFlight.map((row) => (
              <li key={`${row.ref}:${row.work}`} className="flex flex-wrap items-baseline gap-x-3">
                <span>{itemTitle(row.ref, row.work)}</span>
                <span className="text-muted-foreground">{stageText(row, now)}</span>
                {row.builderThreadId !== null ? <ThreadLink threadId={row.builderThreadId}>builder</ThreadLink> : null}
                <ItemLink link={row.link} managerThreadId={managerThreadId} />
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section id="tab-blocked" title="Blocked">
        {manifest.blocked.length === 0 ? (
          <Empty>Nothing blocked</Empty>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {manifest.blocked.map((row) => (
              <li key={row.ref} className="flex flex-wrap items-baseline gap-x-3">
                <span>{row.ref}</span>
                <span className="text-muted-foreground">{blockedText(row.blockedOn)}</span>
                <ItemLink link={row.link} managerThreadId={managerThreadId} />
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section id="tab-landed" title="Landed" note="last 7 days">
        {manifest.landed.length === 0 ? (
          <Empty>Nothing landed in the last 7 days</Empty>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {manifest.landed.map((row) => (
              <li key={`${row.ref}:${row.merged}`} className="flex flex-wrap items-baseline gap-x-3">
                <span>{itemTitle(row.ref, row.spec)}</span>
                <span className="text-muted-foreground">{dateTimeLabel(row.merged)}</span>
                <ItemLink link={row.link} managerThreadId={managerThreadId} />
              </li>
            ))}
          </ul>
        )}
      </Section>
      {manifest.written.map((section, at) => (
        <Section key={`${section.heading}:${at}`} id={`tab-written-${at}`} title={section.heading}>
          {section.markdown.trim() === "" ? <Empty>Nothing written.</Empty> : <Markdown content={section.markdown} />}
        </Section>
      ))}
      {manifest.unreadable.length > 0 ? (
        <Section id="tab-unreadable" title="Unreadable rows" note={`in ${fleet}'s manifest`}>
          <ul className="flex flex-col gap-1 text-sm text-destructive">
            {manifest.unreadable.map((row) => (
              <li key={`${row.section}:${row.line}`}>{unreadableRowText(row)}</li>
            ))}
          </ul>
        </Section>
      ) : null}
    </>
  );
}

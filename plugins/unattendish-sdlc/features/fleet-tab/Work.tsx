import { Fragment, type ReactNode } from "react";
import { UrlLink } from "@get-bb/plugin-sdk/app";
import type { FleetDetailView, LinkView } from "@/src/fleet/application/views";
import { dateTimeLabel } from "@/shared/format";
import { QueueRow, UnreadableRow } from "@/shared/inbox/QueueRow";
import { shortLinkLabel } from "@/shared/inbox/row-model";
import { useRowActions } from "@/shared/inbox/use-row-action";
import { itemTitle } from "@/shared/item-title";
import { ItemLink, LINK_CLASS, ThreadLink } from "@/shared/ItemLink";
import { Glyph } from "@/shared/look/Glyph";
import { ICONS, STAGE_ICONS } from "@/shared/look/icons";
import { COUNT_TONES, type Tone } from "@/shared/look/tones";
import { Empty, Fold } from "./Fold";
import { manifestProblemText, refLinks, SECTION_TITLES, sectionCount, stageText, unreadableIn, unreadableRowId, WORK_SECTIONS, type WorkSection } from "./model";

type OkManifest = Extract<FleetDetailView["manifest"], { status: "ok" }>;

const SECTION_ICONS: Readonly<Record<WorkSection, string>> = { inbox: ICONS.waiting, inFlight: ICONS.inFlight, blocked: ICONS.blocked, landed: ICONS.merged };
const SECTION_TONES: Readonly<Record<WorkSection, Tone>> = { inbox: COUNT_TONES.waiting, inFlight: COUNT_TONES.inFlight, blocked: COUNT_TONES.blocked, landed: COUNT_TONES.landed };

interface WorkProps {
  readonly detail: FleetDetailView;
  readonly managerThreadId: string;
  readonly open: Readonly<Record<WorkSection, boolean>>;
  onToggle(section: WorkSection): void;
  readonly touch: boolean;
  readonly refetch: () => Promise<void>;
}

/** The Work tab: the manifest's rows in four folding sections, or why there are none to show. */
export function Work({ detail, managerThreadId, open, onToggle, touch, refetch }: WorkProps) {
  const problem = manifestProblemText(detail.manifest);
  if (problem !== null || detail.manifest.status !== "ok") return <Empty>{problem ?? ""}</Empty>;
  const manifest = detail.manifest;
  const props = { manifest, managerThreadId, now: detail.generatedAt };
  const body: Readonly<Record<WorkSection, ReactNode>> = {
    inbox: <WaitsOnYou {...props} touch={touch} refetch={refetch} />,
    inFlight: <InFlight {...props} />,
    blocked: <Blocked {...props} links={refLinks(detail.watched)} />,
    landed: <Landed {...props} />,
  };
  return (
    <div className="flex flex-col">
      {WORK_SECTIONS.map((section) => (
        <Fold key={section} id={`fleet-tab-${section}`} icon={SECTION_ICONS[section]} tone={SECTION_TONES[section]} title={SECTION_TITLES[section]} count={sectionCount(manifest, section)} open={open[section]} onToggle={() => onToggle(section)}>
          {body[section]}
        </Fold>
      ))}
    </div>
  );
}

interface SectionProps {
  readonly manifest: OkManifest;
  readonly managerThreadId: string;
  readonly now: string;
}

const LIST = "flex flex-col divide-y divide-border";

function WaitsOnYou({ manifest, now, touch, refetch }: SectionProps & { touch: boolean; refetch: () => Promise<void> }) {
  const stateOf = useRowActions(refetch);
  if (manifest.inbox.length === 0 && manifest.unreadableInbox.length === 0) return <Empty>Nothing waits on you</Empty>;
  return (
    <ul className={LIST}>
      {manifest.inbox.map((row) => (
        <QueueRow key={row.id} row={row} now={now} fleet={undefined} showFleet={false} layout="two-line" touch={touch} state={stateOf(row)} />
      ))}
      {manifest.unreadableInbox.map((row) => (
        <UnreadableRow key={row.line} id={unreadableRowId("inbox", row.line)} row={row} />
      ))}
    </ul>
  );
}

/** The rows of a section the plugin cannot read, as red lines at its top. */
function Unreadable({ manifest, section }: { manifest: OkManifest; section: Exclude<WorkSection, "inbox"> }) {
  return (
    <>
      {unreadableIn(manifest, section).map((row) => (
        <UnreadableRow key={row.line} id={unreadableRowId(section, row.line)} row={row} />
      ))}
    </>
  );
}

/** A row in two lines: its icon and title, then its link and what else it says. */
function TwoLines({ icon, tone, title, children }: { icon: string; tone: Tone; title: string; children: ReactNode }) {
  return (
    <li className="flex flex-col gap-0.5 py-2">
      <span className="flex min-w-0 items-center gap-2">
        <Glyph name={icon} tone={tone} />
        <span className="min-w-0 truncate text-sm">{title}</span>
      </span>
      <span className="flex min-w-0 flex-wrap items-center gap-x-3 pl-[1.375rem] text-xs text-muted-foreground">{children}</span>
    </li>
  );
}

function RowLink({ link, managerThreadId }: { link: LinkView; managerThreadId: string }) {
  return <ItemLink link={link} managerThreadId={managerThreadId} label={shortLinkLabel({ link })} className="text-xs" />;
}

function InFlight({ manifest, managerThreadId, now }: SectionProps) {
  if (manifest.inFlight.length === 0 && unreadableIn(manifest, "inFlight").length === 0) return <Empty>Nothing in flight</Empty>;
  return (
    <ul className={LIST}>
      <Unreadable manifest={manifest} section="inFlight" />
      {manifest.inFlight.map((row) => (
        <TwoLines key={`${row.ref}:${row.work}`} icon={STAGE_ICONS[row.stage]} tone={COUNT_TONES.inFlight} title={itemTitle(row.ref, row.work)}>
          <RowLink link={row.link} managerThreadId={managerThreadId} />
          <span>{stageText(row, now)}</span>
          {row.builderThreadId !== null ? <ThreadLink threadId={row.builderThreadId}>builder</ThreadLink> : null}
        </TwoLines>
      ))}
    </ul>
  );
}

function Blocked({ manifest, managerThreadId, links }: SectionProps & { links: ReadonlyMap<string, string> }) {
  if (manifest.blocked.length === 0 && unreadableIn(manifest, "blocked").length === 0) return <Empty>Nothing blocked</Empty>;
  return (
    <ul className={LIST}>
      <Unreadable manifest={manifest} section="blocked" />
      {manifest.blocked.map((row) => (
        <TwoLines key={row.ref} icon={ICONS.blocked} tone={COUNT_TONES.blocked} title={row.ref}>
          <RowLink link={row.link} managerThreadId={managerThreadId} />
          <span>
            waits for{" "}
            {row.blockedOn.map((ref, at) => {
              const url = links.get(ref);
              return (
                <Fragment key={ref}>
                  {at > 0 ? ", " : null}
                  {url !== undefined ? (
                    <UrlLink href={url} className={LINK_CLASS}>
                      {ref}
                    </UrlLink>
                  ) : (
                    ref
                  )}
                </Fragment>
              );
            })}
          </span>
        </TwoLines>
      ))}
    </ul>
  );
}

function Landed({ manifest, managerThreadId }: SectionProps) {
  if (manifest.landed.length === 0 && unreadableIn(manifest, "landed").length === 0) return <Empty>Nothing landed in the last 7 days</Empty>;
  return (
    <ul className={LIST}>
      <Unreadable manifest={manifest} section="landed" />
      {manifest.landed.map((row) => (
        <TwoLines key={`${row.ref}:${row.merged}`} icon={ICONS.merged} tone={COUNT_TONES.landed} title={itemTitle(row.ref, row.spec)}>
          <RowLink link={row.link} managerThreadId={managerThreadId} />
          <span>merged {dateTimeLabel(row.merged)}</span>
        </TwoLines>
      ))}
    </ul>
  );
}

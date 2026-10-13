import { Markdown } from "@get-bb/plugin-sdk/app";
import type { FleetDetailView } from "@/src/fleet/application/views";
import { Empty } from "./Fold";
import { manifestProblemText } from "./model";

/** The Notes tab: each section the manifest keeps as written, under its own heading, rendered as Markdown. */
export function Notes({ manifest }: { manifest: FleetDetailView["manifest"] }) {
  const problem = manifestProblemText(manifest);
  if (problem !== null || manifest.status !== "ok") return <Empty>{problem ?? ""}</Empty>;
  if (manifest.written.length === 0) return <Empty>The manifest has no written sections.</Empty>;
  return (
    <div className="flex flex-col gap-4">
      {manifest.written.map((section, at) => (
        <section key={`${section.heading}:${at}`} aria-labelledby={`fleet-tab-note-${at}`} className="flex flex-col gap-1">
          <h3 id={`fleet-tab-note-${at}`} className="text-sm font-semibold">
            {section.heading}
          </h3>
          {section.markdown.trim() === "" ? <Empty>Nothing written.</Empty> : <Markdown content={section.markdown} />}
        </section>
      ))}
    </div>
  );
}

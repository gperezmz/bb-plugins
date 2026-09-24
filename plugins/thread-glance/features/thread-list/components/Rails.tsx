// The guide rails of a nested row: one hairline per nesting level,
// drawn inside the row so they join up from row to row.
import type { Nesting } from "@/shared/preferences";
import { railLeft, type Rail } from "../model/layout";

// `start` begins just under the 16px status slot, which is centred in the row.
const SPAN: Record<Rail, { top: string; bottom: string }> = {
  start: { top: "calc(50% + 10px)", bottom: "0px" },
  full: { top: "0px", bottom: "0px" },
  end: { top: "0px", bottom: "50%" },
};

export function RowRails({ rails, nesting }: { rails: readonly (Rail | null)[]; nesting: Nesting }) {
  if (rails.every((rail) => rail === null)) return null;
  return (
    <span aria-hidden data-rails="" className="pointer-events-none absolute inset-0">
      {rails.map((rail, level) =>
        rail === null ? null : (
          <span
            key={level}
            className="absolute w-px bg-border"
            style={{ left: railLeft(level, nesting), ...SPAN[rail] }}
          />
        ),
      )}
    </span>
  );
}

import { Fragment } from "react";
import { cn } from "@/lib/utils";
import { Glyph } from "../look/Glyph";
import { ICONS } from "../look/icons";
import { MARKED_STEP_NAMES, MARKED_STEPS, type MarkedStep, type StepMark } from "./model";

/** Account › Token › Done: a step done with a green check, the current one solid, those still to come grey. */
export function StepMarker({ marks }: { marks: Readonly<Record<MarkedStep, StepMark>> }) {
  return (
    <ol aria-label="Steps" className="flex flex-wrap items-center gap-1.5 text-xs">
      {MARKED_STEPS.map((step, index) => {
        const mark = marks[step];
        return (
          <Fragment key={step}>
            {index > 0 ? (
              <li aria-hidden className="text-muted-foreground">
                ›
              </li>
            ) : null}
            <li aria-current={mark === "current" ? "step" : undefined} data-mark={mark} className={cn("flex items-center gap-1.5", mark === "later" ? "text-muted-foreground" : "font-medium")}>
              {mark === "done" ? (
                <Glyph name={ICONS.done} tone="green" label="done" className="size-4" />
              ) : (
                <span aria-hidden className={cn("flex size-4 items-center justify-center rounded-full text-[10px] tabular-nums", mark === "current" ? "bg-foreground text-background" : "border border-border")}>
                  {index + 1}
                </span>
              )}
              {MARKED_STEP_NAMES[step]}
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}

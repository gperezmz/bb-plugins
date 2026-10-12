import type { ReactNode } from "react";

/** A titled section of the Fleet tab. */
export function Section({ id, title, note, children }: { id: string; title: string; note?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h3 id={id} className="text-sm font-semibold">
        {title} {note !== undefined ? <span className="font-normal text-muted-foreground">{note}</span> : null}
      </h3>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: string }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

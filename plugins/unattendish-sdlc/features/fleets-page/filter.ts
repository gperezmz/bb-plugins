// The fleet the queue is filtered to, kept while the operator leaves the Fleets page and comes back, as opening a
// fleet's Fleet tab makes them: the page unmounts when bb goes to the manager's thread.

let remembered: string | null = null;

export function rememberedFilter(): string | null {
  return remembered;
}

export function rememberFilter(fleet: string | null): void {
  remembered = fleet;
}

// Two-letter provider marks when a provider has no logo. Pure.

export interface ProviderLike {
  id: string;
  displayName?: string | null;
}

function words(text: string): string[] {
  return text
    .split(/[^\p{L}\p{N}]+/u)
    .map((word) => word.trim())
    .filter((word) => word.length > 0);
}

function candidates(provider: ProviderLike): string[] {
  const name = provider.displayName?.trim() || provider.id;
  const parts = words(name);
  const idParts = words(provider.id);
  const first = (parts[0] ?? provider.id)[0] ?? "?";
  const options: string[] = [];
  const push = (second: string | undefined) => {
    if (second === undefined) return;
    const mark = (first + second).toUpperCase();
    if (!options.includes(mark)) options.push(mark);
  };
  // Default: the first two letters of the name.
  push((parts[0] ?? "")[1]);
  // On a clash: the next word's initial, then letters from the id.
  for (const part of parts.slice(1)) push(part[0]);
  for (const part of idParts) for (const letter of part) push(letter);
  for (const letter of (parts[0] ?? "").slice(2)) push(letter);
  if (options.length === 0) options.push(first.toUpperCase());
  return options;
}

/**
 * Assigns each provider a two-letter mark, unique within the roster.
 * Providers keep roster order, so the first of two clashing names keeps the
 * default mark.
 */
export function assignProviderMarks(roster: readonly ProviderLike[]): Map<string, string> {
  const marks = new Map<string, string>();
  const used = new Set<string>();
  for (const provider of roster) {
    const options = candidates(provider);
    const mark = options.find((option) => !used.has(option)) ?? options[0]!;
    used.add(mark);
    marks.set(provider.id, mark);
  }
  return marks;
}

/** The mark for one provider id, falling back to the id while loading. */
export function providerMark(
  providerId: string,
  marks: ReadonlyMap<string, string>,
): string {
  return marks.get(providerId) ?? candidates({ id: providerId })[0]!;
}

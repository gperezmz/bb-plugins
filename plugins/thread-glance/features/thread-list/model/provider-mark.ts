// Two-letter provider marks when a provider has no logo, and what a row
// draws for its harness. Pure.

export interface ProviderLike {
  id: string;
  displayName?: string | null;
}

/** What a row draws for its harness: its logo, or its mark. */
export interface ProviderDisplay {
  id: string;
  name: string;
  /** The roster entry, when the provider is known and has a logo. */
  provider: {
    id: string;
    logoUrl?: string | null;
    icon?: { glyph: string } | null;
    strings?: { iconTint?: { light: string; dark: string } | null } | null;
  } | null;
  mark: string;
}

/**
 * One display per harness, made on first ask and the same object on every
 * later one, so rows can compare it by identity.
 */
export function providerDisplays(
  roster: readonly (ProviderLike & { logoUrl?: string | null } & NonNullable<ProviderDisplay["provider"]>)[],
): (providerId: string) => ProviderDisplay {
  const marks = assignProviderMarks(roster);
  const byProvider = new Map(roster.map((info) => [info.id, info]));
  const displays = new Map<string, ProviderDisplay>();
  return (providerId) => {
    let display = displays.get(providerId);
    if (display === undefined) {
      const info = byProvider.get(providerId);
      display = {
        id: providerId,
        name: info?.displayName ?? providerId,
        provider: info?.logoUrl ? info : null,
        mark: providerMark(providerId, marks),
      };
      displays.set(providerId, display);
    }
    return display;
  };
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

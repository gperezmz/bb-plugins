// A project's monogram: the letter that stands for it and the tile it sits
// on. Pure.

/** The tiles a monogram can sit on, chosen from the name. */
export const MONOGRAM_TILES = 8;

/** Leading words many project names share; skipped while another word follows. */
const GENERIC_WORDS = new Set(["bb", "plugin", "the", "my"]);

function words(name: string): string[] {
  // An npm scope or a path says where the project lives, not what it is.
  const base =
    name
      .trim()
      .replace(/^@[^/]+\//u, "")
      .split(/[\\/]/u)
      .at(-1) ?? "";
  return base
    .replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** The uppercase first letter of the name's first meaningful word, or "#" when it has none. */
export function monogramLetter(name: string): string {
  const all = words(name);
  const first = all.find((word, index) => index === all.length - 1 || !GENERIC_WORDS.has(word.toLowerCase())) ?? "";
  return first === "" ? "#" : [...first][0]!.toLocaleUpperCase();
}

/** The tile (0 to 7) the name picks: the same name always gets the same one. */
export function monogramTile(name: string): number {
  let hash = 0x811c9dc5;
  for (const char of name.trim().toLocaleLowerCase()) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % MONOGRAM_TILES;
}

/** The tiles' colours, used at the monogram's opacity when project colours are off. */
export const MONOGRAM_TILE_COLOURS: readonly string[] = ["#e11d48", "#ea580c", "#ca8a04", "#16a34a", "#0d9488", "#2563eb", "#7c3aed", "#c026d3"];

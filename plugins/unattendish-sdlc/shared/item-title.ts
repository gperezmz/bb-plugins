// Naming an item: its Ref and what it is. A Ref of `—` means the row has no item of its own, and is left out.

/** True where a row has an item of its own. */
export function hasRef(ref: string): boolean {
  return ref !== "—" && ref !== "";
}

/** The item and its title: `ENG-212 which locale wins?`. */
export function itemTitle(ref: string, title: string): string {
  return hasRef(ref) ? `${ref} ${title}` : title;
}

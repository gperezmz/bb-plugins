// Every item's height in px, from what it is and the viewport, never
// measured, so the list can window its rows and stand spacers in for the
// ones it does not mount. The row components size themselves to these.

export interface Heights {
  shelfHeader: number;
  groupHeader: number;
  loadMore: number;
  /** Space above every shelf header but the first of a group. */
  shelfGap: number;
  fullCard: number;
  /** A full card in a Project-mode group, whose header names the project: no project line. */
  groupedCard: number;
  foldedCard: number;
  slimRow: number;
  /** A row in a child list. */
  childRow: number;
}

const DESKTOP: Heights = {
  shelfHeader: 28,
  groupHeader: 28,
  loadMore: 28,
  shelfGap: 8,
  fullCard: 72,
  groupedCard: 52,
  foldedCard: 32,
  slimRow: 32,
  childRow: 28,
};

/** bb's compact viewport: touch targets are taller. */
const COMPACT: Heights = {
  shelfHeader: 36,
  groupHeader: 36,
  loadMore: 36,
  shelfGap: 8,
  fullCard: 80,
  groupedCard: 58,
  foldedCard: 40,
  slimRow: 40,
  childRow: 36,
};

export function heightsFor(compact: boolean): Heights {
  return compact ? COMPACT : DESKTOP;
}

// How the dashboard orders what it lists.

/** A comparator putting the item whose ISO 8601 time (`time` gives it) is later first; equal times keep their order. */
export const newestFirst =
  <Item>(time: (item: Item) => string) =>
  (a: Item, b: Item): number => {
    const left = time(a);
    const right = time(b);
    return left < right ? 1 : left > right ? -1 : 0;
  };

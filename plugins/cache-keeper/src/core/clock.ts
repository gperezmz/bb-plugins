/**
 * Cache Keeper's clock. Every time the plugin reads (now, a deadline, an idle
 * stretch, a no-output wait, a transcript's or an event's time) goes through
 * one clock. It is wall time, except under the drive harness, which may move
 * it forward. A jump moves every later wall time with it, so a time recorded
 * after a jump reads on the jumped clock, and one recorded before it does not.
 */

/** A move of the clock: from wall time `at` on, the clock reads `offset` ms ahead of the wall. */
export interface Jump {
  at: number;
  offset: number;
}

/** How far ahead of the wall the clock read at wall time `wall`. */
export function offsetAt(jumps: readonly Jump[], wall: number): number {
  let offset = 0;
  for (const jump of jumps) {
    if (jump.at > wall) break;
    offset = jump.offset;
  }
  return offset;
}

/** A wall time (a transcript line's, a file's, a bb event's) on the clock. */
export const onClock = (jumps: readonly Jump[], wall: number) => wall + offsetAt(jumps, wall);

export interface Clock {
  now(): number;
  /** A wall time recorded elsewhere, on this clock. */
  fromWall(wall: number): number;
  /** Every jump so far, oldest first; empty on wall time. */
  jumps(): readonly Jump[];
}

/** Wall time: nothing can move it. */
export const wallClock = (wallNow: () => number = Date.now): Clock => ({
  now: wallNow,
  fromWall: (wall) => wall,
  jumps: () => [],
});

/** The drive harness's clock: wall time until `advance` moves it forward. */
export class DriveClock implements Clock {
  private readonly moves: Jump[] = [];

  constructor(private readonly wallNow: () => number = Date.now) {}

  now(): number {
    const wall = this.wallNow();
    return onClock(this.moves, wall);
  }

  fromWall(wall: number): number {
    return onClock(this.moves, wall);
  }

  jumps(): readonly Jump[] {
    return this.moves;
  }

  /** Moves the clock `ms` forward from now. */
  advance(ms: number): void {
    if (!(ms > 0)) throw new RangeError(`the clock only moves forward, not by ${ms} ms`);
    const at = this.wallNow();
    this.moves.push({ at, offset: offsetAt(this.moves, at) + ms });
  }
}

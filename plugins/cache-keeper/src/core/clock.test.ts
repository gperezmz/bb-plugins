import { describe, expect, it } from "vitest";
import { DriveClock, onClock, wallClock } from "./clock";

describe("clock", () => {
  it("is wall time with no jumps", () => {
    const clock = wallClock(() => 5_000);
    expect(clock.now()).toBe(5_000);
    expect(clock.fromWall(4_000)).toBe(4_000);
    expect(clock.jumps()).toEqual([]);
  });

  it("moves every later wall time with a jump, and none before it", () => {
    let wall = 1_000;
    const clock = new DriveClock(() => wall);
    clock.advance(60_000);
    expect(clock.now()).toBe(61_000);
    wall = 2_000;
    clock.advance(240_000);
    expect(clock.now()).toBe(302_000);
    expect(clock.fromWall(500)).toBe(500);
    expect(clock.fromWall(1_500)).toBe(61_500);
    expect(clock.fromWall(2_500)).toBe(302_500);
    expect(onClock(clock.jumps(), 2_500)).toBe(302_500);
  });

  it("never moves back", () => {
    expect(() => new DriveClock(() => 0).advance(-1)).toThrow(RangeError);
  });
});

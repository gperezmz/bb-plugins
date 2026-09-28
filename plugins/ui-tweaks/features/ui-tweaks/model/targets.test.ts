// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { missingTargets } from "./targets";

const ROOT = { "--text-sm": ".8125rem" };

function view(html: string): HTMLElement {
  const element = document.createElement("div");
  element.setAttribute("data-thread-window", "");
  element.innerHTML = html;
  return element;
}

const COLUMN = '<div class="mx-auto max-w-[760px]" style="--md-content-w: 760px;"></div>';
const COMPOSER = '<div class="mx-auto max-w-[760px] chat-prompt-box"></div>';

describe("a thread view's targets", () => {
  it("are all there in bb 0.44's thread view", () => {
    expect(missingTargets(view(COLUMN + COMPOSER), ROOT)).toEqual([]);
  });

  it("name each one that is missing", () => {
    expect(missingTargets(view('<div class="max-w-[800px]" style="--md-content-w: 800px;"></div>'), {})).toEqual([
      "the transcript column (.max-w-[760px] with an inline --md-content-w)",
      "the composer column (.chat-prompt-box.max-w-[760px])",
      "the text size variable --text-sm at :root",
    ]);
  });

  it("miss the column when it lost its inline --md-content-w", () => {
    expect(missingTargets(view('<div class="max-w-[760px]"></div>' + COMPOSER), ROOT)).toEqual([
      "the transcript column (.max-w-[760px] with an inline --md-content-w)",
    ]);
  });
});

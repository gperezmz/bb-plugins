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
const EDITOR = '<div data-promptbox-editor-scroll class="text-sm"><div class="ProseMirror" contenteditable="true"></div></div>';
const COMPOSER = `<div class="mx-auto max-w-[760px] chat-prompt-box"><div data-follow-up-composer>${EDITOR}</div></div>`;

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

  it("miss the composer's editor wrapper while the composer shows an editor without one", () => {
    const composer = '<div class="max-w-[760px] chat-prompt-box"><div data-follow-up-composer><div contenteditable="true"></div></div></div>';
    expect(missingTargets(view(COLUMN + composer), ROOT)).toEqual([
      "the composer's editor wrapper ([data-follow-up-composer] [data-promptbox-editor-scroll])",
    ]);
  });

  it("miss the editor wrapper when the only one in the composer column is a queued message's", () => {
    const composer = `<div class="max-w-[760px] chat-prompt-box"><ul><li data-queued-message-inline-editor>${EDITOR}</li></ul></div>`;
    expect(missingTargets(view(COLUMN + composer), ROOT)).toEqual([
      "the composer's editor wrapper ([data-follow-up-composer] [data-promptbox-editor-scroll])",
    ]);
  });

  it("do not include the editor wrapper while the composer shows no editor", () => {
    expect(missingTargets(view(COLUMN + '<div class="max-w-[760px] chat-prompt-box"><button>Unarchive</button></div>'), ROOT)).toEqual([]);
  });

  it("miss the column when it lost its inline --md-content-w", () => {
    expect(missingTargets(view('<div class="max-w-[760px]"></div>' + COMPOSER), ROOT)).toEqual([
      "the transcript column (.max-w-[760px] with an inline --md-content-w)",
    ]);
  });
});

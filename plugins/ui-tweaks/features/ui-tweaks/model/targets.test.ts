// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { missingNewThreadTargets, missingTargets } from "./targets";

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

  it("do not count a queued message's editor as the composer's", () => {
    const composer = `<div class="max-w-[760px] chat-prompt-box"><ul><li data-queued-message-inline-editor><div data-follow-up-composer>${EDITOR}</div></li></ul></div>`;
    expect(missingTargets(view(COLUMN + composer), ROOT)).toEqual([]);
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

describe("a New-thread screen's targets", () => {
  function editorIn(html: string): Element {
    const element = document.createElement("div");
    element.innerHTML = html;
    return element.querySelector("#root-compose-prompt")!;
  }

  const EDITOR = '<div id="root-compose-prompt" contenteditable="true"></div>';
  const WRAPPED = `<div data-promptbox-editor-scroll class="text-sm"><div data-promptbox-editor-content>${EDITOR}</div></div>`;

  it("are all there in bb 0.44's New-thread screen", () => {
    const html = `<div class="mx-auto flex max-w-[760px] pt-14" style="--md-content-w: 760px;"><form data-promptbox>${WRAPPED}</form></div>`;
    expect(missingNewThreadTargets(editorIn(html), ROOT)).toEqual([]);
  });

  it("are all there in bb 0.44's compact layout, whose column has no inline --md-content-w", () => {
    const html = `<div data-testid="root-compose-compact-composer"><div class="mx-auto w-full max-w-[760px] px-4"><form data-promptbox>${WRAPPED}</form></div></div>`;
    expect(missingNewThreadTargets(editorIn(html), ROOT)).toEqual([]);
  });

  it("miss the editor wrapper when the editor carries the wrapper's attribute itself", () => {
    const html = `<div class="max-w-[760px]" style="--md-content-w: 760px;"><div id="root-compose-prompt" data-promptbox-editor-scroll contenteditable="true"></div></div>`;
    expect(missingNewThreadTargets(editorIn(html), ROOT)).toEqual(["its editor wrapper ([data-promptbox-editor-scroll])"]);
  });

  it("name each one that is missing", () => {
    expect(missingNewThreadTargets(editorIn(`<div class="max-w-[800px]">${EDITOR}</div>`), {})).toEqual([
      "its column (.max-w-[760px])",
      "its editor wrapper ([data-promptbox-editor-scroll])",
      "the text size variable --text-sm at :root",
    ]);
  });
});

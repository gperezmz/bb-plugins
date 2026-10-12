// Atlassian Document Format to the text the plugin reads a comment's last line from.
// Node names and attributes follow https://developer.atlassian.com/cloud/jira/platform/apis/document/structure/
// and the per-node pages under .../document/nodes/: a `doc` of block nodes holding inline nodes, `text` carrying
// its words in `text`, `hardBreak` a newline, `mention` and `emoji` their `attrs.text`, `inlineCard` its `attrs.url`.
// The pages say nothing of how a block boundary reads, so each block node here starts and ends a line.

const MAX_DEPTH = 50;

const INLINE_TEXT = new Set(["text"]);
const INLINE_ATTRIBUTE: Record<string, readonly string[]> = {
  mention: ["text"],
  emoji: ["text", "shortName"],
  status: ["text"],
  inlineCard: ["url"],
};

interface Node {
  readonly type?: unknown;
  readonly text?: unknown;
  readonly attrs?: unknown;
  readonly content?: unknown;
}

const isNode = (value: unknown): value is Node => typeof value === "object" && value !== null && !Array.isArray(value);

const attribute = (node: Node, names: readonly string[]): string => {
  if (!isNode(node.attrs)) return "";
  const attrs = node.attrs as Record<string, unknown>;
  for (const name of names) if (typeof attrs[name] === "string") return attrs[name];
  return "";
};

const render = (node: unknown, depth: number): string => {
  if (!isNode(node) || depth > MAX_DEPTH) return "";
  const type = typeof node.type === "string" ? node.type : "";
  if (INLINE_TEXT.has(type)) return typeof node.text === "string" ? node.text : "";
  if (type === "hardBreak") return "\n";
  if (type in INLINE_ATTRIBUTE) return attribute(node, INLINE_ATTRIBUTE[type]!);
  const children = Array.isArray(node.content) ? node.content.map((child) => render(child, depth + 1)).join("") : "";
  return type === "doc" ? children : `\n${children}\n`;
};

/** Whether a value has the shape of an ADF document: an object whose `type` is `doc`. */
export const isDocument = (body: unknown): boolean => isNode(body) && body.type === "doc";

/** An ADF document's rendered text: each block and each `hardBreak` on its own line. */
export const documentText = (body: unknown): string => render(body, 0);

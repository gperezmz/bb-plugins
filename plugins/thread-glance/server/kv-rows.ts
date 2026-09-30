// Reads every kv row under a prefix. Plugin KV has no bulk read, so a cold
// start fetches rows in parallel batches rather than awaiting one at a time.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

const READ_BATCH = 50;

/** Each row's key without `prefix`, and its stored value, in listing order. */
export async function readRows(
  kv: BbPluginApi["storage"]["kv"],
  prefix: string,
): Promise<[id: string, value: unknown][]> {
  const keys = await kv.list(prefix);
  const rows: [string, unknown][] = [];
  for (let start = 0; start < keys.length; start += READ_BATCH) {
    const batch = keys.slice(start, start + READ_BATCH);
    const values = await Promise.all(batch.map((key) => kv.get<unknown>(key)));
    batch.forEach((key, i) => rows.push([key.slice(prefix.length), values[i]]));
  }
  return rows;
}

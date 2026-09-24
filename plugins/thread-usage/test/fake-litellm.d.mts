export type FakeMode = "ok" | "down" | "bad-key" | "no-spend" | "no-spend-401" | "no-route" | "empty";
export declare const MODES: FakeMode[];
export type SpendRow = Record<string, unknown>;
export declare function makeRow(partial?: SpendRow): SpendRow;
export interface FakeRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string | string[] | undefined>;
}
export interface FakeLiteLlm {
  url: string;
  port: number;
  requests: FakeRequest[];
  setRows(rows: SpendRow[]): void;
  addRow(row: SpendRow): SpendRow;
  setMode(mode: FakeMode): void;
  readonly mode: FakeMode;
  close(): Promise<void>;
}
export declare function startFakeLiteLlm(opts?: {
  port?: number;
  key?: string;
  host?: string;
  rows?: SpendRow[];
  modelInfo?: unknown[];
}): Promise<FakeLiteLlm>;

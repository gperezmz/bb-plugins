export declare const MODELS: string[];
export interface FakeRequest {
  path: string;
  authorized: boolean;
  body: Record<string, unknown>;
  /** When the request's connection closed, in epoch milliseconds. */
  closedAt: number | undefined;
  /** The message content it was answered with, once it was. */
  answer: string | undefined;
}
export interface FakeLiteLlm {
  url: string;
  port: number;
  requests: FakeRequest[];
  close(): Promise<void>;
}
export declare function startFakeLiteLlm(opts?: {
  port?: number;
  key?: string;
  host?: string;
  slowMs?: number;
}): Promise<FakeLiteLlm>;

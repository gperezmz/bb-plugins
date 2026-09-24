export declare const MODELS: string[];
export interface FakeRequest {
  path: string;
  authorized: boolean;
  body: Record<string, unknown>;
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

// Mounts a scripted fake service on a loopback port, logging every request and
// answering `/__admin/*` so a test or the drive harness can load its state and
// read what was asked. Written in erasable TypeScript only (no enums,
// namespaces or parameter properties), because the drive harness runs it with
// `node` directly.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface LoggedRequest {
  readonly method: string;
  readonly url: string;
  readonly body: string;
  readonly hasAuthorization: boolean;
  readonly at: string;
}

export interface FakeService {
  /** Answers the request and returns true, or returns false to let the mount answer 404. */
  handle(request: IncomingMessage, body: string, response: ServerResponse): boolean | Promise<boolean>;
  setState(state: unknown): void;
  getState(): unknown;
}

export interface Mounted {
  readonly url: string;
  readonly port: number;
  readonly requests: LoggedRequest[];
  close(): Promise<void>;
}

export const sendJson = (response: ServerResponse, body: unknown, status = 200, headers: Record<string, string> = {}): void => {
  response.writeHead(status, { "content-type": "application/json", ...headers });
  response.end(JSON.stringify(body));
};

export async function listen(fake: FakeService, port = 0): Promise<Mounted> {
  const requests: LoggedRequest[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", async () => {
      const body = Buffer.concat(chunks).toString();
      const url = request.url ?? "/";
      try {
        if (url.startsWith("/__admin/")) {
          if (url === "/__admin/state" && request.method === "POST") fake.setState(JSON.parse(body));
          else if (url === "/__admin/state") return sendJson(response, fake.getState());
          else if (url === "/__admin/requests") return sendJson(response, requests);
          else if (url === "/__admin/reset") requests.length = 0;
          else return sendJson(response, { message: "no such admin route" }, 404);
          return sendJson(response, { ok: true });
        }
        requests.push({ method: request.method ?? "", url, body, hasAuthorization: request.headers.authorization !== undefined, at: new Date().toISOString() });
        if (!(await fake.handle(request, body, response))) sendJson(response, { message: "Not Found" }, 404);
      } catch (error) {
        sendJson(response, { message: String(error) }, 500);
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const bound = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${bound}`,
    port: bound,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

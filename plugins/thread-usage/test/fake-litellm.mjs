#!/usr/bin/env node
/**
 * A dependency-free fake of the LiteLLM proxy routes the `litellm` adapter
 * reads: `/health/liveliness`, `/key/info`, `/spend/logs/v2` and
 * `/model/info`. Use it from tests with {@link startFakeLiteLlm}, or run it
 * for a live check against a running bb:
 *
 *   node test/fake-litellm.mjs --port 4455 --key sk-test
 *   curl -X POST localhost:4455/__admin/rows -d '{"session_id":"bb-thr_x","spend":0.12}'
 *   curl -X POST localhost:4455/__admin/mode -d '{"mode":"no-spend"}'
 *
 * Failure modes, so each Test connection check can fail on its own:
 * `ok`, `down` (every non-admin request's socket is destroyed, so clients see
 * a network error), `bad-key` (401 on every
 * authenticated route), `no-spend` (403 on /spend/logs/v2), `no-spend-401`
 * (401 on /spend/logs/v2 only, as LiteLLM answers a role that may not read
 * spend logs), `no-route`
 * (404 on /spend/logs/v2) and `empty` (no rows).
 */
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

export const MODES = ["ok", "down", "bad-key", "no-spend", "no-spend-401", "no-route", "empty"];
const MAX_PAGE_SIZE = 1000;
const TOTAL_CAP = 10_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/** Fills a partial row with LiteLLM's spend-log fields. */
export function makeRow(partial = {}) {
  const start = partial.startTime ?? new Date().toISOString();
  const startMs = Date.parse(start);
  const duration = partial.request_duration_ms ?? 1200;
  const prompt = partial.prompt_tokens ?? 100;
  const completion = partial.completion_tokens ?? 20;
  return {
    request_id: partial.request_id ?? `req-${randomUUID()}`,
    session_id: partial.session_id ?? null,
    call_type: "acompletion",
    api_key: "hashed-key",
    startTime: start,
    endTime: partial.endTime ?? new Date(startMs + duration).toISOString(),
    model: partial.model ?? "claude-opus-5-5",
    model_group: partial.model_group ?? partial.model ?? "claude-opus-5-5",
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: partial.total_tokens ?? prompt + completion,
    spend: partial.spend ?? 0.001,
    request_duration_ms: duration,
    status: partial.status ?? "success",
    request_tags: partial.request_tags ?? [],
    metadata: partial.metadata ?? {},
    ...partial,
  };
}

function parseDate(text) {
  // LiteLLM dates are UTC wall-clock times.
  return Date.parse(`${text.replace(" ", "T")}Z`);
}

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });
}

/**
 * Starts the fake. `port` 0 (default) picks a free port.
 *
 * @param {{ port?: number, key?: string, rows?: object[], modelInfo?: object[], host?: string }} [opts]
 */
export async function startFakeLiteLlm(opts = {}) {
  const key = opts.key ?? "sk-test";
  let rows = (opts.rows ?? []).map(makeRow);
  let mode = "ok";
  const modelInfo = opts.modelInfo ?? [
    {
      model_name: "claude-opus-5",
      litellm_params: { model: "anthropic/claude-opus-5-5" },
      model_info: {
        input_cost_per_token: 4e-6,
        output_cost_per_token: 2e-5,
        cache_read_input_token_cost: 2e-7,
        cache_creation_input_token_cost: 5e-6,
      },
    },
  ];
  /** Every request served (admin routes excluded), for assertions. */
  const requests = [];
  const sockets = new Set();

  const authorized = (req) => {
    if (mode === "bad-key") return false;
    const header = req.headers.authorization ?? req.headers["x-litellm-api-key"] ?? "";
    const given = String(header).replace(/^Bearer\s+/i, "");
    return given === key;
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://fake");
    // Admin routes stay up in every mode, so a CLI user can bring it back.
    if (mode === "down" && !url.pathname.startsWith("/__admin/")) {
      req.socket.destroy();
      return;
    }
    if (url.pathname.startsWith("/__admin/")) {
      const body = req.method === "POST" ? await readBody(req) : "";
      let json = {};
      try {
        json = body === "" ? {} : JSON.parse(body);
      } catch {
        return send(res, 400, { error: "invalid JSON" });
      }
      if (url.pathname === "/__admin/rows") {
        if (req.method === "GET") return send(res, 200, { data: rows });
        if (req.method === "DELETE") {
          rows = [];
          return send(res, 200, { count: 0 });
        }
        for (const r of Array.isArray(json) ? json : [json]) rows.push(makeRow(r));
        return send(res, 200, { count: rows.length });
      }
      if (url.pathname === "/__admin/mode") {
        if (!MODES.includes(json.mode)) return send(res, 400, { error: `mode must be one of ${MODES.join(", ")}` });
        setMode(json.mode);
        return send(res, 200, { mode });
      }
      return send(res, 404, { error: "unknown admin route" });
    }

    requests.push({ method: req.method ?? "GET", path: url.pathname, query: Object.fromEntries(url.searchParams), headers: req.headers });

    if (url.pathname === "/health/liveliness") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end('"I\'m alive!"');
    }
    if (url.pathname === "/key/info") {
      if (!authorized(req)) return send(res, 401, { error: { message: "Authentication Error, Invalid proxy server token passed.", type: "auth_error", code: "401" } });
      return send(res, 200, { key: "hashed-key", info: { key_name: "sk-...test", user_role: "proxy_admin_viewer", spend: 0 } });
    }
    if (url.pathname === "/model/info" || url.pathname === "/v1/model/info") {
      if (!authorized(req)) return send(res, 401, { error: { message: "Authentication Error", code: "401" } });
      return send(res, 200, { data: modelInfo });
    }
    if (url.pathname === "/spend/logs/v2") {
      if (!authorized(req)) return send(res, 401, { error: { message: "Authentication Error", code: "401" } });
      if (mode === "no-route") return send(res, 404, { detail: "Not Found" });
      // Real LiteLLM answers 401 to a valid key whose role may not use the route.
      if (mode === "no-spend-401") return send(res, 401, { error: { message: "Authentication Error - this key's role may not call /spend/logs/v2", code: "401" } });
      if (mode === "no-spend") return send(res, 403, { error: { message: "key not allowed to access this route", code: "403" } });
      const q = url.searchParams;
      const startDate = q.get("start_date");
      const endDate = q.get("end_date");
      if (startDate === null || endDate === null) {
        return send(res, 400, { error: { message: "start_date and end_date are required", code: "400" } });
      }
      if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
        return send(res, 400, { error: { message: "dates must be YYYY-MM-DD HH:MM:SS", code: "400" } });
      }
      const page = Number(q.get("page") ?? "1");
      const pageSize = Number(q.get("page_size") ?? "50");
      if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
        return send(res, 422, { detail: [{ loc: ["query", "page_size"], msg: `must be 1..${MAX_PAGE_SIZE}` }] });
      }
      const from = parseDate(startDate);
      const to = parseDate(endDate);
      const session = q.get("session_id");
      const asc = q.get("sort_order") === "asc";
      const matching = (mode === "empty" ? [] : rows)
        .filter((r) => {
          const t = Date.parse(r.startTime);
          return t >= from && t <= to;
        })
        .filter((r) => session === null || (typeof r.session_id === "string" && r.session_id.includes(session)))
        .sort((a, b) => (asc ? 1 : -1) * (Date.parse(a.startTime) - Date.parse(b.startTime)));
      // LiteLLM caps the count at 10,000 and computes total_pages from the capped count.
      const total = Math.min(matching.length, TOTAL_CAP);
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      return send(res, 200, {
        data: matching.slice((page - 1) * pageSize, page * pageSize),
        total,
        page,
        page_size: pageSize,
        total_pages: totalPages,
        total_is_capped: matching.length > TOTAL_CAP,
      });
    }
    return send(res, 404, { detail: "Not Found" });
  });

  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, opts.host ?? "127.0.0.1", () => resolve(undefined));
  });
  const port = /** @type {import("node:net").AddressInfo} */ (server.address()).port;

  function setMode(next) {
    if (!MODES.includes(next)) throw new Error(`unknown mode ${next}`);
    mode = next;
    if (mode === "down") for (const s of sockets) s.destroy();
  }

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    requests,
    setRows(next) {
      rows = next.map(makeRow);
    },
    addRow(row) {
      const full = makeRow(row);
      rows.push(full);
      return full;
    },
    setMode,
    get mode() {
      return mode;
    },
    close() {
      for (const s of sockets) s.destroy();
      return new Promise((resolve) => server.close(() => resolve(undefined)));
    },
  };
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const fake = await startFakeLiteLlm({
    port: Number(arg("port", "4455")),
    key: arg("key", "sk-test"),
    host: arg("host", "127.0.0.1"),
  });
  const mode = arg("mode", "ok");
  if (mode !== "ok") fake.setMode(mode);
  console.log(`fake LiteLLM on ${fake.url} (key ${arg("key", "sk-test")}, mode ${mode})`);
  console.log(`  add rows:  curl -X POST ${fake.url}/__admin/rows -d '{"session_id":"bb-thr_…","spend":0.05}'`);
  console.log(`  list rows: curl ${fake.url}/__admin/rows`);
  console.log(`  set mode:  curl -X POST ${fake.url}/__admin/mode -d '{"mode":"no-spend"}'  (${MODES.join(" | ")})`);
  const stop = () => fake.close().then(() => process.exit(0));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

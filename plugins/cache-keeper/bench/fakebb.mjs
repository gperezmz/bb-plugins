// The fake bb: a thread table and an event store in SQLite behind loopback
// HTTP, answering the `bb.sdk` calls Cache Keeper's server makes, in the
// shapes bb 0.44 gives them. It counts the calls and the CPU it spends
// serving the plugin apart from the world's writes, which are bb's own cost.
//
//   node fakebb.mjs <db path>     (forked by the benchmark; sends its port)
import http from "node:http";
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync(process.argv[2] ?? ":memory:");
db.exec(`PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;
CREATE TABLE IF NOT EXISTS events (thread_id TEXT, seq INTEGER, type TEXT, created_at INTEGER, data TEXT, PRIMARY KEY (thread_id, seq)) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS events_type ON events (thread_id, type, seq);
CREATE TABLE IF NOT EXISTS threads (id TEXT PRIMARY KEY, listed INTEGER, row TEXT);`);
const insertEvent = db.prepare("INSERT INTO events VALUES (?, ?, ?, ?, ?)");
const putRow = db.prepare("INSERT INTO threads VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET listed = excluded.listed, row = excluded.row");
const getRow = db.prepare("SELECT row FROM threads WHERE id = ?");
const listRows = db.prepare("SELECT row FROM threads WHERE listed = 1 ORDER BY id LIMIT ? OFFSET ?");
const maxSeq = db.prepare("SELECT max(seq) AS seq FROM events WHERE thread_id = ?");
const queries = new Map();

/** Events of a thread after a seq, of some types or all, oldest or newest first. */
function eventQuery(types, order) {
  const key = `${types}:${order}`;
  let q = queries.get(key);
  if (q === undefined) {
    const filter = types === 0 ? "" : ` AND type IN (${Array(types).fill("?").join(", ")})`;
    q = db.prepare(`SELECT seq, type, created_at, data FROM events WHERE thread_id = ? AND seq > ?${filter} ORDER BY seq ${order === "desc" ? "DESC" : "ASC"} LIMIT ?`);
    queries.set(key, q);
  }
  return q;
}

const seqs = new Map();
const nextSeq = (threadId) => {
  let seq = seqs.get(threadId);
  if (seq === undefined) seq = maxSeq.get(threadId)?.seq ?? 0;
  seqs.set(threadId, ++seq);
  return seq;
};
const queued = new Map();
let sent = [];
let request = 0;

const stats = { cpuMs: 0, calls: 0, bytesOut: 0, byMethod: {} };

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const rowOf = (threadId) => {
  const r = getRow.get(threadId);
  return r === undefined ? null : JSON.parse(r.row);
};
const save = (row) => putRow.run(row.id, row.archivedAt === null && row.deletedAt === null ? 1 : 0, JSON.stringify(row));

/** The thread as bb's events and `threads.get` give it: no pending interaction, machine or command count. */
function dto(row) {
  const { hasPendingInteraction: _p, environmentHostId: _h, queuedWork, activity, ...rest } = row;
  return { ...rest, activeBackgroundAgentCount: activity.activeBackgroundAgentCount, queuedMessageCount: queuedWork === "waiting" ? 1 : 0 };
}

function ingest(threadId, type, createdAt, data) {
  const seq = nextSeq(threadId);
  insertEvent.run(threadId, seq, type, createdAt, JSON.stringify(data));
  return seq;
}

const sdk = {
  "threads.list"({ offset = 0, limit = 50 }) {
    return listRows.all(limit, offset).map((r) => JSON.parse(r.row));
  },
  "threads.get"({ threadId, include }) {
    const row = rowOf(threadId);
    if (row === null || row.deletedAt !== null) throw new HttpError(404, `thread ${threadId} not found`);
    return include === "environment" ? { ...dto(row), environment: { id: `env_${threadId}`, hostId: row.environmentHostId } } : dto(row);
  },
  "threads.interactions.list"({ threadId }) {
    return rowOf(threadId)?.hasPendingInteraction ? [{ id: "int_1", threadId, kind: "question" }] : [];
  },
  "threads.queuedMessages.list"({ threadId }) {
    return queued.get(threadId) ?? [];
  },
  "threads.queuedMessages.delete"({ threadId, queuedMessageId }) {
    queued.set(threadId, (queued.get(threadId) ?? []).filter((r) => r.id !== queuedMessageId));
    return { ok: true };
  },
  "threads.context"({ threadId }) {
    const row = rowOf(threadId);
    if (row === null) throw new HttpError(404, `thread ${threadId} not found`);
    return { threadId, usage: row.providerId === "claude-code" ? { modelContextWindow: 1_000_000, totalTokens: 120_000 } : null };
  },
  "threads.events.list"({ threadId, afterSeq = "0", order = "asc", limit = "100", types }) {
    const list = Array.isArray(types) ? types : [];
    const rows = eventQuery(list.length, order).all(threadId, Number(afterSeq), ...list, Math.min(100, Number(limit)));
    return rows.map((r) => ({ id: `evt_${threadId}_${r.seq}`, threadId, seq: r.seq, type: r.type, createdAt: r.created_at, data: JSON.parse(r.data) }));
  },
  "threads.send"({ threadId, input }) {
    const row = rowOf(threadId);
    if (row === null || row.deletedAt !== null) throw new HttpError(404, `thread ${threadId} not found`);
    if (row.status !== "idle" && row.status !== "error") throw new HttpError(409, "thread is active");
    const now = Date.now();
    const requestId = `creq_${++request}`;
    ingest(threadId, "client/turn/requested", now, { requestId, initiator: "user", input, target: { kind: "new-turn" } });
    // bb takes a plugin's send as the user's: the thread is read, and it starts.
    save({ ...row, status: "active", lastReadAt: now, updatedAt: now });
    const text = input.map((b) => b.text ?? "").join("");
    sent.push({ threadId, text, requestId });
    return { threadId, queued: false };
  },
  "threads.markRead"({ threadId }) {
    const row = rowOf(threadId);
    if (row !== null) save({ ...row, lastReadAt: Date.now() });
    return { ok: true };
  },
  "threads.markUnread"({ threadId }) {
    const row = rowOf(threadId);
    if (row !== null) save({ ...row, lastReadAt: null });
    return { ok: true };
  },
};

/** The world's side: bb's own writes, not counted as serving the plugin. */
const world = {
  "/ingest"(body) {
    db.exec("BEGIN");
    try {
      for (const [threadId, type, createdAt, data] of body) ingest(threadId, type, createdAt, data);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return { ok: true };
  },
  "/threads/put"(body) {
    db.exec("BEGIN");
    // The world leaves out the read state bb keeps: markRead and markUnread own it.
    for (const row of body) save({ ...(rowOf(row.id) ?? {}), ...row });
    db.exec("COMMIT");
    return { ok: true };
  },
  "/threads/get"(body) {
    return body.map(rowOf);
  },
  "/queued/put"({ threadId, rows }) {
    queued.set(threadId, rows);
    return { ok: true };
  },
  "/drain"() {
    const out = sent;
    sent = [];
    return out;
  },
  "/stats"() {
    return { ...stats, events: db.prepare("SELECT count(*) AS n FROM events").get().n };
  },
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(chunks.length === 0 ? null : JSON.parse(Buffer.concat(chunks).toString("utf8"))));
    req.on("error", reject);
  });
}

http
  .createServer({ keepAlive: true }, async (req, res) => {
    const path = req.url ?? "/";
    const plugin = path.startsWith("/sdk/");
    let c0 = null;
    let status = 200;
    let out;
    try {
      const body = await readBody(req);
      // Counted from here: requests overlap while their bodies arrive.
      if (plugin) c0 = process.cpuUsage();
      if (plugin) {
        const method = path.slice(5);
        const handler = sdk[method];
        if (handler === undefined) throw new HttpError(404, `no method ${method}`);
        out = handler(body ?? {});
        stats.byMethod[method] = (stats.byMethod[method] ?? 0) + 1;
      } else {
        const handler = world[path];
        if (handler === undefined) throw new HttpError(404, `no route ${path}`);
        out = handler(body);
      }
    } catch (error) {
      status = error.status ?? 500;
      out = { error: error.message };
      if (status === 500) console.error(error);
    }
    const text = JSON.stringify(out);
    res.writeHead(status, { "content-type": "application/json" });
    res.end(text);
    if (c0 !== null) {
      const c = process.cpuUsage(c0);
      stats.cpuMs += (c.user + c.system) / 1000;
      stats.calls++;
      stats.bytesOut += Buffer.byteLength(text);
    }
  })
  .listen(0, "127.0.0.1", function () {
    process.send({ port: this.address().port });
  });
// Exits with the benchmark that forked it, however that ends.
process.on("disconnect", () => process.exit(0));

// The host process: the plugin's real host entry (bench/.build/host.mjs)
// behind loopback HTTP, as bb's daemon runs it on the machine a thread runs
// on. It validates each call's input against the host contract, as the
// daemon does, and counts calls and the transcript bytes read; its CPU
// is the whole process's. `CLAUDE_CONFIG_DIR` and `TMPDIR` point it at the
// benchmark's files.
//
//   node hostproc.mjs <bundled host.mjs>     (forked by the benchmark; sends its port)
import http from "node:http";
import { pathToFileURL } from "node:url";

const entry = (await import(pathToFileURL(process.argv[2]).href)).default;
const stats = { calls: 0, bytesRead: 0, byMethod: {} };
const context = { experimental_retainWorker: () => ({ dispose: async () => {} }), signals: {} };

async function call(method, input) {
  const contract = entry.contract[method];
  if (contract === undefined) throw new Error(`no host method ${method}`);
  const valid = await contract.input["~standard"].validate(input);
  if (valid.issues !== undefined) throw new Error(`invalid input: ${JSON.stringify(valid.issues).slice(0, 300)}`);
  return entry.handlers[method](valid.value, context);
}

http
  .createServer({ keepAlive: true }, (req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", async () => {
      // The process does nothing but answer calls: its whole CPU is the host's, HTTP included.
      if (req.url === "/stats") {
        const c = process.cpuUsage();
        return res.end(JSON.stringify({ ...stats, cpuMs: (c.user + c.system) / 1000 }));
      }
      let status = 200;
      let out;
      try {
        const { method, input } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        out = await call(method, input);
        stats.byMethod[method] = (stats.byMethod[method] ?? 0) + 1;
        if (method === "transcript") stats.bytesRead += out.bytesRead;
      } catch (error) {
        status = 500;
        out = { error: error.message };
      }
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(out));
      stats.calls++;
    });
  })
  .listen(0, "127.0.0.1", function () {
    process.send({ port: this.address().port });
  });
// Exits with the benchmark that forked it, however that ends.
process.on("disconnect", () => process.exit(0));

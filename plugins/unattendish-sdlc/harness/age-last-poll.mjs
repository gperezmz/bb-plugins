// Moves a fleet's stored "last polled" time back, so the plugin's next poll
// finds itself that long after the last one, as it would after the machine was
// off. The clock the plugin reads is wall time, and a catch-up needs a gap of
// ten minutes. Run only while the plugin is disabled, since it holds the
// database open otherwise.
//
//   node age-last-poll.mjs <data.db> <host/owner/repo> <minutes>
import { DatabaseSync } from "node:sqlite";

const [file, repo, minutes] = process.argv.slice(2);
if (file === undefined || repo === undefined || !(Number(minutes) > 0)) {
  console.error("usage: age-last-poll.mjs <data.db> <host/owner/repo> <minutes>");
  process.exit(2);
}
const db = new DatabaseSync(file);
const row = db.prepare("SELECT last_polled_at FROM fleets WHERE repo_id = ?").get(repo.toLowerCase());
if (row === undefined || row.last_polled_at === null) {
  console.error(`age-last-poll.mjs: ${repo} has no stored poll time`);
  process.exit(1);
}
const aged = new Date(Date.parse(row.last_polled_at) - Number(minutes) * 60_000).toISOString();
db.prepare("UPDATE fleets SET last_polled_at = ? WHERE repo_id = ?").run(aged, repo.toLowerCase());
db.close();
console.log(aged);

// The fake forges and trackers the drives point the plugin at: GitHub, GitLab,
// Linear and Jira Cloud, each from `test/fakes/` on a loopback port of its own.
// Every one answers `/__admin/state` (POST loads its state, GET reads it),
// `/__admin/requests` (every request, with its method and URL) and
// `/__admin/reset` (empties the request log), so a drive scripts a service and
// reads what the plugin asked of it with `curl` and nothing else.
//
//   GITHUB_PORT=40191 GITLAB_PORT=40192 LINEAR_PORT=40193 JIRA_PORT=40194 node fake-services.ts
//
// Node strips the types; the fakes are written to be run that way.
import { createFakeGithub } from "../test/fakes/github.ts";
import { createFakeGitlab } from "../test/fakes/gitlab.ts";
import { createFakeJira } from "../test/fakes/jira.ts";
import { createFakeLinear } from "../test/fakes/linear.ts";
import { listen } from "../test/fakes/listen.ts";

const port = (name: string): number => {
  const value = Number(process.env[name]);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} is not a port`);
  return value;
};

const services = [
  { name: "github", fake: createFakeGithub(), port: port("GITHUB_PORT") },
  { name: "gitlab", fake: createFakeGitlab(), port: port("GITLAB_PORT") },
  { name: "linear", fake: createFakeLinear({ users: [], issues: [] }), port: port("LINEAR_PORT") },
  { name: "jira", fake: createFakeJira(), port: port("JIRA_PORT") },
];

const mounted = await Promise.all(services.map(async (service) => ({ name: service.name, mount: await listen(service.fake, service.port) })));
for (const { name, mount } of mounted) console.log(`${name} ${mount.url}`);

const stop = (): void => {
  void Promise.all(mounted.map(({ mount }) => mount.close())).then(() => process.exit(0));
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);

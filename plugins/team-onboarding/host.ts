// Team Onboarding's host entry: runs on every machine's daemon as the
// daemon's OS user. It only exposes the allow-listed operations in
// src/contract/host.ts.
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk";
import { hostContract, hostSignals } from "./src/contract/host.js";
import { createOps, defaultDeps } from "./src/host/ops.js";

// Methods that need the plugin's data folder get it from their call's context.
const noDataDir = (): string => {
  throw new Error("this method has no plugin data folder");
};
const ops = createOps(defaultDeps(async () => {}, noDataDir));

export default experimental_defineHostEntry({
  contract: hostContract,
  experimental_signals: hostSignals,
  handlers: {
    probe: () => ops.probe(),
    sshKeygen: (input) => ops.sshKeygen(input),
    writeSshConfig: (input) => ops.writeSshConfig(input),
    writeKnownHosts: (input) => ops.writeKnownHosts(input),
    gitConfig: (input) => ops.gitConfig(input),
    sshTest: (input) => ops.sshTest(input),
    lsRemote: (input, context) =>
      createOps(defaultDeps(async () => {}, () => context.experimental_paths.dataDir)).lsRemote(input, context.signal),
    ghStatus: (input) => ops.ghStatus(input),
    ghAgentsStatus: (input) => ops.ghAgentsStatus(input),
    ghSetupGit: (input) => ops.ghSetupGit(input),
    ghApiRepo: (input) => ops.ghApiRepo(input),
    ghSshKeyAdd: (input) => ops.ghSshKeyAdd(input),
    signingTest: (input) => ops.signingTest(input),
    startDeviceLogin: (input, context) =>
      // One ops instance per login, so its code goes out on this call's signal.
      createOps(
        defaultDeps((payload) => context.experimental_emitSignal("deviceCode", payload), noDataDir),
      ).startDeviceLogin(input, context.signal),
    runCheck: (input, context) => ops.runCheck(input, context.signal),
    toolVersion: (input) => ops.toolVersion(input),
  },
});

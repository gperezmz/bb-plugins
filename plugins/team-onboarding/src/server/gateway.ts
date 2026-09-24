// Reaches the host entry on a machine, with these fallbacks:
// if the host entry can't load, server-machine operations run in the
// server process, and other machines report `no-host-entry` so the checklist
// offers **Check in terminal** instead.
import { join } from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { PluginRpcResult } from "@get-bb/plugin-sdk";
import { hostContract, hostSignals, type HostContract, type HostMethod } from "../contract/host.js";
import { createOps, defaultDeps, type HostOps } from "../host/ops.js";
import { countHostCall } from "./meter.js";

export class NoHostEntryError extends Error {
  constructor(readonly hostId: string) {
    super("The onboarding host entry isn't available on this machine.");
  }
}

type Input<M extends HostMethod> = Parameters<HostOps[M]>[0];
type Output<M extends HostMethod> = PluginRpcResult<HostContract[M]>;

export interface CallOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export class HostGateway {
  private readonly client;
  /** Whether the host entry answered on each machine; unknown until probed. */
  private readonly available = new Map<string, boolean>();
  private local: HostOps | null = null;

  constructor(
    private readonly bb: BbPluginApi,
    private readonly serverHostId: () => string | null,
    private readonly onDeviceCode: (hostId: string, payload: { loginId: string; code: string; url: string }) => void,
  ) {
    this.client = bb.hosts.experimental_client({ contract: hostContract, experimental_signals: hostSignals });
    bb.onDispose(
      this.client.experimental_onSignal("deviceCode", ({ hostId, payload }) => {
        this.onDeviceCode(hostId, payload);
      }),
    );
    bb.onDispose(
      this.client.experimental_onWorkerExit(({ hostId }) => {
        bb.log.warn(`host worker exited on ${hostId}`);
      }),
    );
  }

  hasEntry(hostId: string): boolean {
    return this.available.get(hostId) !== false;
  }

  /**
   * Probes a machine. A probe that fails for any reason other than a timeout
   * or cancellation marks the host entry unavailable there until the next
   * successful probe.
   */
  async probe(hostId: string, options: CallOptions = {}): Promise<Output<"probe">> {
    const started = performance.now();
    try {
      const result = await this.client.call("probe", {}, { hostId, timeoutMs: options.timeoutMs ?? 30_000, signal: options.signal });
      this.available.set(hostId, true);
      return result;
    } catch (error) {
      if (options.signal?.aborted || isTimeout(error)) throw error;
      this.available.set(hostId, false);
      if (hostId === this.serverHostId()) return this.localOps().probe();
      throw new NoHostEntryError(hostId);
    } finally {
      countHostCall(hostId, "probe", performance.now() - started);
    }
  }

  async call<M extends HostMethod>(
    method: M,
    hostId: string,
    input: Input<M>,
    options: CallOptions = {},
  ): Promise<Output<M>> {
    const local = this.available.get(hostId) === false;
    if (local && hostId !== this.serverHostId()) throw new NoHostEntryError(hostId);
    const started = performance.now();
    try {
      if (local) return await this.runLocal(method, input, options);
      return (await this.client.call(method, input as never, {
        hostId,
        timeoutMs: options.timeoutMs,
        signal: options.signal,
      })) as Output<M>;
    } finally {
      countHostCall(hostId, method, performance.now() - started);
    }
  }

  private localOps(): HostOps {
    if (this.local === null) {
      const serverId = this.serverHostId();
      this.local = createOps(
        defaultDeps(
          async (payload) => {
            if (serverId !== null) this.onDeviceCode(serverId, payload);
          },
          () => pluginDataDir(this.bb),
        ),
      );
    }
    return this.local;
  }

  private async runLocal<M extends HostMethod>(method: M, input: Input<M>, options: CallOptions): Promise<Output<M>> {
    // Same input check the daemon applies to the host entry.
    const checked = await hostContract[method].input["~standard"].validate(input);
    if (checked.issues !== undefined) throw new Error(`invalid ${method} input: ${checked.issues[0]?.message ?? "rejected"}`);
    const ops = this.localOps() as unknown as Record<string, (input: unknown, signal?: AbortSignal) => Promise<unknown>>;
    return (await ops[method]!(checked.value, options.signal)) as Output<M>;
  }
}

/** The plugin's own folder in the server's data directory (where its database lives). */
export function pluginDataDir(bb: BbPluginApi): string {
  return join(bb.server.experimental_dataDir, "plugins", bb.pluginId);
}

function isTimeout(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /timeout|timed out|aborted/i.test(text);
}

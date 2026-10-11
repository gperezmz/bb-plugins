// Workspace ports: what the host entry reports, what the server keeps as the
// snapshot, and what the app reads and sends. Nothing here imports the SDK, so
// the app bundle can use its values.
import * as z from "zod/mini";
import { versionedSchema } from "./signals";

/** The shape of a bb thread id. The host entry returns an owner only when it has this shape. */
export const THREAD_ID_PATTERN = /^thr_[A-Za-z0-9]+$/;

const portSchema = z.number().check(z.int(), z.minimum(1), z.maximum(65_535));
const pidSchema = z.number().check(z.int(), z.minimum(1));

// --- The host entry (`host.ts`): runs on each machine bb runs threads on. ---

/**
 * One listening TCP socket whose process works inside a workspace. The host
 * entry returns nothing else about a process: the command line and the
 * environment stay on the host.
 */
export const hostListenerSchema = z.strictObject({
  port: portSchema,
  /** The address the socket is bound to, as the system prints it: `127.0.0.1`, `::1`, `0.0.0.0`, `*`, `[::]`, … */
  address: z.string().check(z.maxLength(64)),
  /** The executable name only; null for a port only Docker reports. */
  process: z.nullable(z.string().check(z.maxLength(256))),
  /** Null for a port only Docker reports. */
  pid: z.nullable(pidSchema),
  /** When the process started, epoch ms, null for a port only Docker reports. Two reads of one process give one value. */
  startedAt: z.nullable(z.number()),
  /** The workspace path, exactly as the request gave it, that the process works inside (longest match on a path boundary). */
  workspace: z.string().check(z.maxLength(4096)),
  /**
   * The thread named by the process's single `BB_THREAD_ID=thr_…` entry; null
   * when it has none, more than one, or a value that is not a thread id.
   */
  ownerThreadId: z.nullable(z.string().check(z.regex(THREAD_ID_PATTERN))),
  /** The Docker container serving the port, when `docker ps` names one. */
  container: z.nullable(z.string().check(z.maxLength(256))),
});
export type HostListener = z.infer<typeof hostListenerSchema>;

export const MAX_WORKSPACES_PER_SCAN = 2_000;
/** The most listeners one `scan` reply holds. */
export const MAX_LISTENERS_PER_SCAN = 5_000;

export const hostContract = {
  /**
   * Lists the listening TCP sockets whose process works inside one of
   * `workspaces`. `supported` is false on a machine the entry does nothing on
   * (Windows), with no listeners.
   */
  scan: {
    input: z.strictObject({ workspaces: z.array(z.string().check(z.maxLength(4096))).check(z.maxLength(MAX_WORKSPACES_PER_SCAN)) }),
    output: z.strictObject({ supported: z.boolean(), listeners: z.array(hostListenerSchema).check(z.maxLength(MAX_LISTENERS_PER_SCAN)) }),
  },
  /**
   * Sends SIGTERM to the process listening on `port` only if it still has
   * `pid` and `startedAt` and still works inside one of `workspaces`;
   * otherwise signals nothing.
   */
  signal: {
    input: z.strictObject({
      port: portSchema,
      pid: pidSchema,
      startedAt: z.number(),
      workspaces: z.array(z.string().check(z.maxLength(4096))).check(z.maxLength(MAX_WORKSPACES_PER_SCAN)),
    }),
    /** `sent`: SIGTERM went out; `changed`: the port, PID or start time no longer matched; `failed`: the signal call failed. */
    output: z.strictObject({ result: z.enum(["sent", "changed", "failed"]) }),
  },
} as const;

/** What the host answers to `signal`. */
export type HostSignalResult = z.infer<typeof hostContract.signal.output>["result"];

// --- The server's snapshot and its channel. ---

/** A listener in a thread's environment, as the app sees it. */
export const portListenerSchema = z.strictObject({
  port: portSchema,
  address: z.string(),
  process: z.nullable(z.string()),
  pid: z.nullable(pidSchema),
  startedAt: z.nullable(z.number()),
  /** The thread that owns the port: its process names it in `BB_THREAD_ID` and the thread works in this environment. */
  ownerThreadId: z.nullable(z.string()),
  container: z.nullable(z.string()),
});
export type PortListener = z.infer<typeof portListenerSchema>;

/** The snapshot of every non-archived thread's environment. */
export const portsSnapshotSchema = z.strictObject({
  /** When the oldest data in it was read, epoch ms. */
  at: z.number(),
  /** Listeners by environment id; an environment with none is absent. */
  environments: z.record(z.string(), z.strictObject({ hostId: z.string(), listeners: z.array(portListenerSchema) })),
  /** Machines whose scan failed and are backing off; their ports are absent. */
  failedHosts: z.array(z.string()),
});
export type PortsSnapshot = z.infer<typeof portsSnapshotSchema>;
export const EMPTY_PORTS: PortsSnapshot = Object.freeze({ at: 0, environments: {}, failedHosts: [] });

export const portsSignalSchema = versionedSchema(portsSnapshotSchema);
export type PortsSignal = z.infer<typeof portsSignalSchema>;

// --- RPC shapes. ---

const idSchema = z.string().check(z.minLength(1), z.maxLength(1024));
export const portTargetSchema = z.strictObject({ port: portSchema, pid: pidSchema, startedAt: z.number() });
export type PortTarget = z.infer<typeof portTargetSchema>;

/** `ports`: `fresh` asks for a new read when the snapshot is older than a couple of seconds; otherwise a snapshot up to 30 s old is answered. */
export const portsInputSchema = z.strictObject({ fresh: z.boolean() });

/** `stopPort`: Stop on one listener of the thread's environment. */
export const stopPortInputSchema = z.strictObject({ threadId: idSchema, ...portTargetSchema.shape });
/** `requested`: SIGTERM went out; `refused`: the snapshot does not list that port, PID and start time in the thread's environment; `gone`: the process changed or ended on the host. */
export const stopPortOutputSchema = z.strictObject({ outcome: z.enum(["requested", "refused", "gone"]) });

/** `ownedPorts`: the ports the thread owns now, from a fresh read. Rejects when the lookup fails. */
export const ownedPortsInputSchema = z.strictObject({ threadId: idSchema });
export const ownedPortsOutputSchema = z.strictObject({
  ports: z.array(z.strictObject({ ...portTargetSchema.shape, process: z.nullable(z.string()) })),
});

/** `closePorts`: Close on the settle prompt. */
export const closePortsInputSchema = z.strictObject({ threadId: idSchema, ports: z.array(portTargetSchema).check(z.maxLength(200)) });
/**
 * `requested`: every matching process got SIGTERM; `partial`: some could not
 * be stopped; `none`: no listed port still matches a thread-owned port, or the
 * thread is no longer settled. Rejects when the lookup or the call fails.
 */
export const closePortsOutputSchema = z.strictObject({ outcome: z.enum(["requested", "partial", "none"]) });

/** `previewClean`: the settled threads in the project scope (null: all projects) and what Clean would close. */
export const previewCleanInputSchema = z.strictObject({ projectId: z.nullable(idSchema) });
export const previewCleanOutputSchema = z.strictObject({
  /** Single-use, valid until `expiresAt`. */
  token: z.string(),
  expiresAt: z.number(),
  /** Only threads with something to close. */
  threads: z.array(
    z.strictObject({
      threadId: z.string(),
      title: z.string(),
      /** Running or starting terminals, typed into or not. */
      terminals: z.number(),
      /** Owned ports that have a start time. */
      ports: z.array(z.strictObject({ port: portSchema, process: z.nullable(z.string()) })),
    }),
  ),
});

/** `runClean`: runs the preview behind `token` once. `expired` is true for an unknown, used or expired token, and the other fields are then empty. */
export const runCleanInputSchema = z.strictObject({ token: z.string() });
export const runCleanOutputSchema = z.strictObject({
  expired: z.boolean(),
  closedTerminals: z.number(),
  portRequests: z.number(),
  /** Ports that still listened after the request and a 750 ms wait. */
  stillListening: z.array(portSchema),
  /** Problems, each naming its thread by title. */
  issues: z.array(z.string()),
});
export type PreviewCleanOutput = z.infer<typeof previewCleanOutputSchema>;
export type RunCleanOutput = z.infer<typeof runCleanOutputSchema>;

// --- Texts the app shows for the settle prompt (the server's outcomes map to these). ---

export const CLOSE_PORTS_OUTCOME_TEXT = {
  requested: { title: "Stop requested for port processes", description: "Processes received a graceful shutdown request. Ports may take a moment to close." },
  partial: { title: "Some port processes could not be stopped" },
  none: { title: "No matching thread-owned ports are still running" },
  failed: { title: "Could not close thread ports" },
} as const;
export const PORTS_CHECK_FAILED_TEXT = "Thread settled, but its ports could not be checked";
export const CLEAN_EXPIRED_TEXT = "Cleanup preview expired. Review the resources again.";
export const CLEAN_NOTHING_TEXT = "No live terminals or thread-owned listening ports found.";

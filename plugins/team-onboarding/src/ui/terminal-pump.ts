// Moves bytes between an xterm view and a bb terminal session.
//
// Output is polled: fast (40 ms) while bytes are flowing, backing off to
// 320 ms when idle, paused while the tab is hidden. Input is batched briefly
// and sent in order. No part of this knows about React.

export interface TerminalIo {
  output(args: { terminalId: string; sinceSeq?: number; tailBytes?: number }): Promise<{
    chunks: { dataBase64: string; seq: number }[];
    nextSeq: number;
    status: "disconnected" | "exited" | "running" | "starting";
    exitCode: number | null;
    truncated: boolean;
  }>;
  input(args: { terminalId: string; dataBase64: string }): Promise<unknown>;
  resize(args: { terminalId: string; cols: number; rows: number }): Promise<unknown>;
}

export interface Sink {
  write(data: Uint8Array): void;
  reset(): void;
  onStatus(status: string, exitCode: number | null): void;
}

export const MIN_POLL_MS = 40;
export const MAX_POLL_MS = 320;
const REPLAY_BYTES = 256_000;
const INPUT_BATCH_MS = 4;
const INPUT_CHUNK = 64 * 1024;

/** Next poll delay: reset when output arrived, otherwise double up to the cap. */
export function nextDelay(current: number, gotOutput: boolean): number {
  return gotOutput ? MIN_POLL_MS : Math.min(MAX_POLL_MS, Math.max(MIN_POLL_MS, current * 2));
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

export class TerminalPump {
  private seq: number | null = null;
  private delay = MIN_POLL_MS;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private pendingInput = "";
  private inputTimer: ReturnType<typeof setTimeout> | null = null;
  private sending: Promise<void> = Promise.resolve();
  private status = "starting";
  private readonly encoder = new TextEncoder();

  constructor(
    private readonly io: TerminalIo,
    private readonly terminalId: string,
    private readonly sink: Sink,
    private readonly isVisible: () => boolean = () => true,
  ) {}

  start(): void {
    this.schedule(0);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) clearTimeout(this.timer);
    if (this.inputTimer !== null) clearTimeout(this.inputTimer);
  }

  /** Queues keystrokes; they go out in order, batched for a few ms. */
  send(data: string): void {
    if (this.stopped || this.status === "exited") return;
    this.pendingInput += data;
    if (this.inputTimer !== null) return;
    this.inputTimer = setTimeout(() => {
      this.inputTimer = null;
      const text = this.pendingInput;
      this.pendingInput = "";
      const bytes = this.encoder.encode(text);
      this.sending = this.sending.then(async () => {
        for (let offset = 0; offset < bytes.length; offset += INPUT_CHUNK) {
          await this.io
            .input({ terminalId: this.terminalId, dataBase64: bytesToBase64(bytes.subarray(offset, offset + INPUT_CHUNK)) })
            .catch(() => {});
        }
      });
      // Typing usually produces output: poll soon.
      this.delay = MIN_POLL_MS;
      this.schedule(MIN_POLL_MS);
    }, INPUT_BATCH_MS);
  }

  resize(cols: number, rows: number): void {
    if (this.stopped) return;
    void this.io.resize({ terminalId: this.terminalId, cols, rows }).catch(() => {});
  }

  private schedule(ms: number): void {
    if (this.stopped) return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.poll(), ms);
  }

  private async poll(): Promise<void> {
    this.timer = null;
    if (this.stopped) return;
    if (!this.isVisible()) {
      this.schedule(MAX_POLL_MS * 2);
      return;
    }
    let gotOutput = false;
    try {
      const response = await this.io.output(
        this.seq === null
          ? { terminalId: this.terminalId, tailBytes: REPLAY_BYTES }
          : { terminalId: this.terminalId, sinceSeq: this.seq },
      );
      if (this.stopped) return;
      if (response.truncated && this.seq !== null) {
        // We fell behind the server's buffer: redraw from the tail.
        this.sink.reset();
        this.seq = null;
        this.schedule(0);
        return;
      }
      for (const chunk of response.chunks) {
        this.sink.write(base64ToBytes(chunk.dataBase64));
        gotOutput = true;
      }
      this.seq = response.nextSeq;
      if (response.status !== this.status) {
        this.status = response.status;
        this.sink.onStatus(response.status, response.exitCode);
      }
      if (response.status === "exited" && !gotOutput) return;
    } catch {
      gotOutput = false;
    }
    this.delay = nextDelay(this.delay, gotOutput);
    this.schedule(this.delay);
  }
}

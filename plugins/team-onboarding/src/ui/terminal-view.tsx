// A setup terminal shown under the checklist item that opened it: what runs
// where, an xterm view over `sdk.terminals`, its status and exit code, and
// Close. The host has no panel call that opens a tab titled after a
// command, so there is no "Open larger": the view is resizable in place.
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useSdk } from "@get-bb/plugin-sdk/app";
import type { TrackedTerminalState } from "../contract/rpc.js";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { errorText, postAction } from "./hooks.js";
import { TerminalPump, type TerminalIo } from "./terminal-pump.js";

export function InlineTerminal({
  terminal,
  machineName,
  onClosed,
}: {
  terminal: TrackedTerminalState;
  machineName: string;
  onClosed: () => void;
}) {
  const [closing, setClosing] = useState(false);
  const command = terminal.command ?? terminal.title;
  const exited = terminal.status === "exited";
  const failed = exited && terminal.exitCode !== null && terminal.exitCode !== 0;
  const status = !exited ? "running" : failed ? `failed · exit ${terminal.exitCode}` : `done${terminal.exitCode === null ? "" : ` · exit ${terminal.exitCode}`}`;
  const close = () => {
    setClosing(true);
    void postAction({ action: "closeTerminal", terminalId: terminal.terminalId }).then(onClosed, (cause) => {
      setClosing(false);
      toast.error(errorText(cause));
    });
  };
  return (
    <section aria-label={`Terminal: ${command}`} className="mt-2 overflow-hidden rounded-md border border-border">
      <header className="flex flex-wrap items-center gap-2 border-b border-border bg-surface-recessed px-2.5 py-1.5 text-xs">
        <Icon name="Terminal" className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 break-words">
          {exited ? "Ran" : "Running"} <code className="break-all font-mono">{command}</code> on <span className="font-medium">{machineName}</span>
        </span>
        <span aria-live="polite" className={cn("shrink-0", !exited ? "text-muted-foreground" : failed ? "text-destructive" : "text-success")}>
          {!exited ? <span aria-hidden="true" className="mr-1.5 inline-block size-1.5 animate-pulse rounded-full bg-current align-middle" /> : null}
          {status}
        </span>
        <Button size="sm" variant="ghost" className="h-6 px-2" onClick={close} disabled={closing} aria-label={`Close terminal: ${command}`}>
          Close
        </Button>
      </header>
      {exited ? (
        <p className="border-b border-border px-2.5 py-1 text-xs text-muted-foreground">
          {terminal.itemId === null ? "It has ended." : "It has ended; its item is checked again."}
        </p>
      ) : null}
      {/* About 12 rows; drag the corner to make it taller. */}
      <div className="h-52 min-h-24 resize-y overflow-hidden" style={{ resize: "vertical" }}>
        <XtermView terminalId={terminal.terminalId} label={`Terminal output: ${command}`} />
      </div>
    </section>
  );
}

export function XtermView({ terminalId, label }: { terminalId: string; label: string }) {
  const sdk = useSdk();
  const host = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<string>("starting");

  useEffect(() => {
    const element = host.current;
    if (element === null) return;
    const term = new Terminal({
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      fontSize: 12,
      cursorBlink: true,
      convertEol: false,
      scrollback: 5000,
      theme: themeFor(element),
    });
    // Follow the host's light/dark switch.
    const themeObserver = new MutationObserver(() => {
      term.options.theme = themeFor(element);
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(element);
    const io: TerminalIo = {
      output: (args) => sdk.terminals.output(args),
      input: (args) => sdk.terminals.input(args),
      resize: (args) => sdk.terminals.resize(args),
    };
    const pump = new TerminalPump(
      io,
      terminalId,
      {
        write: (data) => term.write(data),
        reset: () => term.reset(),
        onStatus: (next, exitCode) => {
          setStatus(next);
          if (next === "exited") term.write(`\r\n\x1b[2m[process exited${exitCode === null ? "" : ` with ${exitCode}`}]\x1b[0m\r\n`);
        },
      },
      () => document.visibilityState === "visible",
    );
    const input = term.onData((data) => pump.send(data));
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const refit = () => {
      if (resizeTimer !== null) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        try {
          fit.fit();
          pump.resize(term.cols, term.rows);
        } catch {
          // Not laid out yet.
        }
      }, 90);
    };
    const observer = new ResizeObserver(refit);
    observer.observe(element);
    refit();
    pump.start();
    return () => {
      pump.stop();
      input.dispose();
      observer.disconnect();
      themeObserver.disconnect();
      if (resizeTimer !== null) clearTimeout(resizeTimer);
      term.dispose();
    };
  }, [sdk, terminalId]);

  return (
    <div className="relative h-full min-h-0 p-1.5">
      <div ref={host} role="group" className="h-full w-full bg-surface-recessed text-foreground" aria-label={label} />
      {status === "disconnected" ? (
        <p className="absolute bottom-3 right-3 rounded bg-card px-2 py-1 text-xs text-muted-foreground">Machine disconnected</p>
      ) : null}
    </div>
  );
}

/** xterm colours from the host theme around the terminal. */
function themeFor(element: HTMLElement) {
  const background = effectiveBackground(element);
  const foreground = toHex([getComputedStyle(element).color]);
  return { background, foreground, cursor: foreground, selectionBackground: `${foreground}40` };
}

/**
 * The colour the terminal actually sits on. Host surfaces are often
 * translucent, so each layer is painted over its ancestors' on a 1×1 canvas,
 * which also turns oklch into the sRGB hex xterm understands.
 */
function effectiveBackground(element: HTMLElement): string {
  const layers: string[] = [];
  for (let node: HTMLElement | null = element; node !== null; node = node.parentElement) {
    const color = getComputedStyle(node).backgroundColor;
    if (color !== "rgba(0, 0, 0, 0)" && color !== "transparent") layers.unshift(color);
  }
  const isDark = document.documentElement.classList.contains("dark");
  return toHex([isDark ? "#000000" : "#ffffff", ...layers]);
}

function toHex(layers: string[]): string {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d");
  if (context === null) return "#000000";
  for (const layer of layers) {
    context.fillStyle = layer;
    context.fillRect(0, 0, 1, 1);
  }
  const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

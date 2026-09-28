/**
 * The Agent tools section's switches: one per agent tool Cache Keeper
 * registers, all off on a fresh install. A thread is offered a tool only
 * while its switch is on; a change reaches a thread when its provider session
 * next starts or resumes.
 */
import type { Store } from "./store";

export const AGENT_TOOLS = {
  compactWhenIdle: { name: "cache_keeper_compact_when_idle", label: "Compact when idle" },
} as const;

export type AgentToolKey = keyof typeof AGENT_TOOLS;

/** One row of the Agent tools section. */
export interface AgentToolRow {
  key: AgentToolKey;
  name: string;
  label: string;
  on: boolean;
}

const META = "agentTools";

export class AgentTools {
  private cache: Partial<Record<AgentToolKey, boolean>> | null = null;

  constructor(private readonly store: Store) {}

  private state(): Partial<Record<AgentToolKey, boolean>> {
    this.cache ??= this.store.getMeta<Partial<Record<AgentToolKey, boolean>>>(META) ?? {};
    return this.cache;
  }

  isOn(key: AgentToolKey): boolean {
    return this.state()[key] === true;
  }

  set(key: AgentToolKey, on: boolean): void {
    this.cache = { ...this.state(), [key]: on };
    this.store.setMeta(META, this.cache);
  }

  allOff(): void {
    this.cache = {};
    this.store.setMeta(META, this.cache);
  }

  rows(): AgentToolRow[] {
    return (Object.keys(AGENT_TOOLS) as AgentToolKey[]).map((key) => ({ key, name: AGENT_TOOLS[key].name, label: AGENT_TOOLS[key].label, on: this.isOn(key) }));
  }

  /** The tool names a thread is offered now. */
  offered(): string[] {
    return this.rows()
      .filter((r) => r.on)
      .map((r) => r.name);
  }
}

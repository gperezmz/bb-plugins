// Edits the plugin's `credentials` and `tokens` settings for the settings
// section. A change is checked by the rules the settings form validates with
// (`parseCredentialEntries`, `parseTokens`), so the two ways in never disagree.
// A token is only ever written: nothing here returns one, logs one, or puts one
// in a reason.
import type { CredentialAdmin, CredentialAdminEntry } from "../application/ports";
import type { CredentialDraft } from "../application/views";
import { parsePrefix } from "../domain/identity";
import { messageOf } from "../domain/redact";
import { parseCredentialEntries, parseTokens, prefixKey } from "./settings";

/** The two settings as the host keeps them. */
export interface CredentialSettings {
  get(): Promise<{ readonly credentials: string; readonly tokens: string | undefined }>;
  experimental_set(values: { credentials?: string | null; tokens?: string | null }): Promise<unknown>;
}

type Outcome = { readonly ok: true } | { readonly ok: false; readonly reason: string };
const refuse = (reason: string): Outcome => ({ ok: false, reason });

type Raw = Record<string, unknown>;

/** The key two spellings of one prefix share, or null for text that is no prefix. */
const keyOf = (text: unknown): string | null => {
  const prefix = typeof text === "string" ? parsePrefix(text) : null;
  return prefix === null ? null : prefixKey(prefix);
};

const isRaw = (value: unknown): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value);

/** The setting's JSON list, or why it is not one. A blank setting is an empty list. */
const listOf = (text: string): { readonly list: unknown[] } | { readonly reason: string } => {
  if (text.trim() === "") return { list: [] };
  try {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value) ? { list: value } : { reason: "credentials must be a JSON list of entries" };
  } catch {
    return { reason: "credentials is not valid JSON" };
  }
};

/** The setting's JSON object from prefix to token, or why it is not one. A blank setting is an empty object. */
const mapOf = (text: string | undefined): { readonly map: Raw } | { readonly reason: string } => {
  if (text === undefined || text.trim() === "") return { map: {} };
  try {
    const value: unknown = JSON.parse(text);
    return isRaw(value) ? { map: { ...value } } : { reason: "tokens must be a JSON object from prefix to token" };
  } catch {
    return { reason: "tokens is not valid JSON" };
  }
};

const tokenKeyFor = (map: Raw, key: string): string | undefined => Object.keys(map).find((written) => keyOf(written) === key);

export class SettingsCredentialAdmin implements CredentialAdmin {
  /** Writes wait for the one before: each reads the settings it changes. */
  private tail: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly settings: CredentialSettings,
    /** Every token the plugin holds, to scrub from any message bb gives back. */
    private readonly secrets: () => string[],
  ) {}

  async list(): Promise<{ readonly entries: readonly CredentialAdminEntry[]; readonly problems: readonly string[] }> {
    const values = await this.settings.get();
    const parsed = parseCredentialEntries(values.credentials);
    const tokens = parseTokens(values.tokens ?? "");
    const raw = listOf(values.credentials);
    const entries: CredentialAdminEntry[] = [];
    if ("list" in raw) {
      raw.list.forEach((item, at) => {
        if (!isRaw(item) || typeof item.prefix !== "string") return;
        const written = item.prefix.trim();
        const key = keyOf(written);
        const hasToken = key !== null && tokens.tokens.has(key);
        const usable = parsed.entries.find((entry) => entry.text === written && key === prefixKey(entry.prefix));
        const fault = parsed.problems.find((problem) => problem.startsWith(`credentials entry ${at + 1}`)) ?? null;
        const auth = usable?.auth ?? (item.auth === "gh" || item.auth === "glab" ? item.auth : "token");
        const noToken = usable !== undefined && auth === "token" && !hasToken ? "no token is stored for this prefix" : null;
        entries.push({
          prefix: written,
          auth,
          service: usable?.service ?? (typeof item.service === "string" ? item.service : null),
          baseUrl: usable?.baseUrl ?? (typeof item.baseUrl === "string" ? item.baseUrl : null),
          hasToken,
          problem: usable === undefined ? (fault ?? "this entry cannot be used") : noToken,
        });
      });
    }
    return { entries, problems: [...parsed.problems, ...tokens.problems] };
  }

  save(draft: CredentialDraft): Promise<Outcome> {
    return this.serially(() => this.write(draft));
  }

  remove(prefix: string): Promise<Outcome> {
    return this.serially(() => this.drop(prefix));
  }

  private serially<T>(work: () => Promise<T>): Promise<T> {
    const next = this.tail.then(work, work);
    this.tail = next.catch(() => undefined);
    return next;
  }

  private async write(draft: CredentialDraft): Promise<Outcome> {
    const prefix = draft.prefix.trim();
    if (prefix === "") return refuse("the prefix is empty");
    if (draft.token !== undefined && /\s/.test(draft.token.trim())) return refuse("the token may not hold whitespace");
    const token = draft.token === undefined || draft.token.trim() === "" ? undefined : draft.token.trim();
    if (token !== undefined && draft.auth !== "token") return refuse(`a ${draft.auth} login takes no token`);

    const values = await this.settings.get();
    const current = listOf(values.credentials);
    if ("reason" in current) return refuse(current.reason);
    const list = current.list;
    const newKey = keyOf(prefix);
    const wasKey = draft.was === undefined ? null : keyOf(draft.was);
    const at = draft.was === undefined ? -1 : list.findIndex((item) => isRaw(item) && (item.prefix === draft.was || (wasKey !== null && keyOf(item.prefix) === wasKey)));
    if (draft.was !== undefined && at === -1) return refuse(`there is no credential for ${draft.was.trim()} to edit`);
    if (newKey !== null && list.some((item, index) => index !== at && isRaw(item) && keyOf(item.prefix) === newKey)) return refuse(`${prefix} already has a credential`);

    const service = draft.service?.trim() ?? "";
    const baseUrl = draft.baseUrl?.trim() ?? "";
    const entry = { prefix, auth: draft.auth, ...(service === "" ? {} : { service }), ...(baseUrl === "" ? {} : { baseUrl }) };
    const next = [...list];
    const index = at === -1 ? next.length : at;
    next[index] = entry;
    const fault = parseCredentialEntries(JSON.stringify(next)).problems.find((problem) => problem.startsWith(`credentials entry ${index + 1}`));
    if (fault !== undefined) return refuse(fault);

    // The token follows the entry: kept under the new spelling of its prefix, replaced by a new one, and dropped for a login.
    const tokens = mapOf(values.tokens);
    if ("reason" in tokens) return refuse(tokens.reason);
    const map = tokens.map;
    const oldKey = tokenKeyFor(map, wasKey ?? newKey ?? "");
    const kept = oldKey === undefined ? undefined : map[oldKey];
    if (oldKey !== undefined) delete map[oldKey];
    const clash = newKey === null ? undefined : tokenKeyFor(map, newKey);
    const stored = token ?? (draft.auth === "token" ? kept : undefined);
    if (stored !== undefined) {
      if (clash !== undefined) delete map[clash];
      map[prefix] = stored;
    }
    const tokensChanged = token !== undefined || oldKey !== undefined || (stored !== undefined && clash !== undefined);
    if (tokensChanged) {
      const problem = parseTokens(JSON.stringify(map)).problems[0];
      if (problem !== undefined) return refuse(problem);
    }
    return this.set({ credentials: JSON.stringify(next, null, 2), ...(tokensChanged ? { tokens: JSON.stringify(map) } : {}) }, token);
  }

  private async drop(prefix: string): Promise<Outcome> {
    const values = await this.settings.get();
    const current = listOf(values.credentials);
    if ("reason" in current) return refuse(current.reason);
    const key = keyOf(prefix);
    const at = current.list.findIndex((item) => isRaw(item) && (item.prefix === prefix.trim() || (key !== null && keyOf(item.prefix) === key)));
    if (at === -1) return refuse(`there is no credential for ${prefix.trim()}`);
    const next = current.list.filter((_, index) => index !== at);
    const tokens = mapOf(values.tokens);
    const stored = "map" in tokens && key !== null ? tokenKeyFor(tokens.map, key) : undefined;
    if ("map" in tokens && stored !== undefined) delete tokens.map[stored];
    return this.set({ credentials: JSON.stringify(next, null, 2), ...("map" in tokens && stored !== undefined ? { tokens: JSON.stringify(tokens.map) } : {}) });
  }

  private async set(values: { credentials: string; tokens?: string }, pasted?: string): Promise<Outcome> {
    try {
      await this.settings.experimental_set(values);
      return { ok: true };
    } catch (error) {
      return refuse(`the settings were not saved: ${messageOf(error, [...this.secrets(), ...(pasted === undefined ? [] : [pasted])])}`);
    }
  }
}

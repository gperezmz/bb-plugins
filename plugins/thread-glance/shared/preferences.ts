// Preference schema shared by the server (kv storage, RPC, CLI) and the app
// (localStorage mirror, first paint). Keys and defaults: docs/reference/thread-glance-preferences.md.
import { z } from "zod";

const MAX_ITEMS = 10_000;
const idSchema = z.string().min(1).max(1024);
const idListSchema = z.array(idSchema).max(MAX_ITEMS);

export const organizationModeSchema = z.enum(["project", "chronological", "machine"]);
export const sortFieldSchema = z.enum(["updated", "created", "alpha", "none"]);
export const sortDirectionSchema = z.enum(["default", "ascending", "descending"]);
export const lifecycleSchema = z.enum(["active", "archived"]);
export const harnessIconSchema = z.enum(["muted", "colour", "hidden"]);
export const childAttentionSchema = z.enum(["blocked", "everything"]);

const hiddenGroupsSchema = z
  .array(z.union([z.literal("threads"), idSchema.regex(/^(project|section|machine):\S+$/)]))
  .max(MAX_ITEMS)
  .transform((groups) => [...new Set(groups)]);

export type OrganizationMode = z.infer<typeof organizationModeSchema>;
export type SortField = z.infer<typeof sortFieldSchema>;
export type SortDirection = z.infer<typeof sortDirectionSchema>;
export type Lifecycle = z.infer<typeof lifecycleSchema>;
export type HarnessIcon = z.infer<typeof harnessIconSchema>;
export type ChildAttention = z.infer<typeof childAttentionSchema>;

interface PreferenceDefinition<T> {
  schema: z.ZodType<T, unknown>;
  defaultValue: T;
  description: string;
}

function define<T>(
  schema: z.ZodType<T, unknown>,
  defaultValue: T,
  description: string,
): PreferenceDefinition<T> {
  return { schema, defaultValue, description };
}

/** Server-side preferences, shared across windows and devices. */
export const PREFERENCES = {
  threadLifecycles: define(
    z
      .array(lifecycleSchema)
      .min(1)
      .max(2)
      .refine((values) => new Set(values).size === values.length, "Lifecycles must be unique"),
    ["active"] as Lifecycle[],
    "Thread lifecycles shown: active, archived, or both. At least one is required.",
  ),
  organizationMode: define(
    organizationModeSchema,
    "project" as OrganizationMode,
    "How top-level groups are formed: project, chronological (custom sections) or machine.",
  ),
  environmentGrouping: define(
    z.boolean(),
    false,
    "Whether sibling threads sharing a worktree environment fold into a folder row.",
  ),
  chronologicalSort: define(
    sortFieldSchema,
    "updated" as SortField,
    "Sort field inside a group: updated, created or alpha. none is read as updated.",
  ),
  sortDirection: define(
    sortDirectionSchema,
    "default" as SortDirection,
    "Sort direction; default keeps the field's natural direction.",
  ),
  sectionOrder: define(
    idListSchema,
    ["pinned", "projects", "threads"],
    "Top-level group order when organized by project.",
  ),
  manualSectionOrder: define(
    idListSchema,
    ["pinned", "sections", "threads"],
    "Top-level group order when organized chronologically.",
  ),
  machineSectionOrder: define(
    idListSchema,
    ["pinned", "machines", "threads"],
    "Top-level group order when organized by machine.",
  ),
  hiddenGroups: define(
    hiddenGroupsSchema,
    [] as string[],
    "Groups moved into More: threads, project:<id>, section:<id> or machine:<id>.",
  ),
  collapsedSections: define(
    z.array(z.enum(["pinned", "threads"])).max(MAX_ITEMS),
    [] as ("pinned" | "threads")[],
    "Built-in groups (pinned, threads) that are collapsed.",
  ),
  collapsedProjects: define(idListSchema, [] as string[], "Project ids whose group is collapsed."),
  collapsedThreadSections: define(
    idListSchema,
    [] as string[],
    "Custom section keys (section:<id>) whose group is collapsed.",
  ),
  collapsedMachines: define(idListSchema, [] as string[], "Machine ids whose group is collapsed."),
  collapsedEnvironments: define(
    idListSchema,
    [] as string[],
    "Environment ids whose folder row is collapsed.",
  ),
  foldOlder: define(
    z.boolean(),
    true,
    "Whether quiet roots past the 5 most recent fold behind an N older row.",
  ),
  workingFirst: define(
    z.boolean(),
    false,
    "Whether working threads sort first under Updated, as bb's list does.",
  ),
  expandedOlder: define(
    idListSchema,
    [] as string[],
    "Group ids and parent thread ids whose N older fold the user opened.",
  ),
  expandedChildren: define(
    idListSchema,
    [] as string[],
    "Parent thread ids whose chip the user opened.",
  ),
  showPullRequests: define(z.boolean(), true, "Whether rows show a pull request badge."),
  childAttention: define(
    childAttentionSchema,
    "blocked" as ChildAttention,
    "Which child threads count under Needs attention, in badges and counters, and stay out of a family's fold along with running children: blocked (waiting on you, offline, or an orphaned failure) or everything (also every failed and unread child).",
  ),
  harnessIcon: define(
    harnessIconSchema,
    "muted" as HarnessIcon,
    "How rows draw the harness logo: muted (monochrome), colour (the provider's tint) or hidden.",
  ),
} as const;

export type PreferenceKey = keyof typeof PREFERENCES;
export type Preferences = {
  -readonly [K in PreferenceKey]: (typeof PREFERENCES)[K]["defaultValue"];
};

export const PREFERENCE_KEYS = Object.keys(PREFERENCES) as PreferenceKey[];

export function isPreferenceKey(key: string): key is PreferenceKey {
  return Object.hasOwn(PREFERENCES, key);
}

export function preferenceDefault<K extends PreferenceKey>(key: K): Preferences[K] {
  return structuredClone(PREFERENCES[key].defaultValue) as Preferences[K];
}

export function defaultPreferences(): Preferences {
  return Object.fromEntries(
    PREFERENCE_KEYS.map((key) => [key, preferenceDefault(key)]),
  ) as Preferences;
}

export function describePreference(key: PreferenceKey): string {
  return PREFERENCES[key].description;
}

export type ParseResult<T> = { success: true; value: T } | { success: false; message: string };

export function parsePreference<K extends PreferenceKey>(
  key: K,
  value: unknown,
): ParseResult<Preferences[K]> {
  const result = PREFERENCES[key].schema.safeParse(value);
  if (result.success) return { success: true, value: result.data as Preferences[K] };
  return { success: false, message: result.error.issues.map((issue) => issue.message).join("; ") };
}

/**
 * Reads a whole preference object, falling back to the default for each key
 * that is missing or invalid. Used for the localStorage mirror.
 */
export function coercePreferences(raw: unknown): Preferences {
  const result = defaultPreferences();
  if (raw === null || typeof raw !== "object") return result;
  const record = raw as Record<string, unknown>;
  for (const key of PREFERENCE_KEYS) {
    if (!(key in record)) continue;
    const parsed = parsePreference(key, record[key]);
    if (parsed.success) (result as Record<string, unknown>)[key] = parsed.value;
  }
  return result;
}

/**
 * Maps bb's own thread-list preferences onto ours for the first-run import
 *. `environmentGrouping: "auto"` becomes off, `collapsedThreads` is
 * skipped because it means the inverse of folded nesting, and invalid values
 * are skipped. Returns only the keys that parsed.
 */
export function mapBbPreferences(raw: unknown): Partial<Preferences> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return {};
  const source = raw as Record<string, unknown>;
  const mapped: Partial<Record<PreferenceKey, unknown>> = {};
  for (const [bbKey, value] of Object.entries(source)) {
    if (bbKey === "collapsedThreads") continue;
    if (!isPreferenceKey(bbKey)) continue;
    const candidate = bbKey === "environmentGrouping" && value === "auto" ? false : value;
    const parsed = parsePreference(bbKey, candidate);
    if (parsed.success) mapped[bbKey] = parsed.value;
  }
  return mapped as Partial<Preferences>;
}

/** Per-client preferences, kept in localStorage only. */
export const clientPreferencesSchema = z.object({
  filter: z.enum(["all", "attention"]).catch("all"),
  density: z.enum(["compact", "comfortable"]).catch("compact"),
});
export type ClientPreferences = z.infer<typeof clientPreferencesSchema>;

export const CLIENT_PREFERENCES_STORAGE_KEY = "bb.thread-glance.client.v1";
export const PREFERENCES_MIRROR_STORAGE_KEY = "bb.thread-glance.preferences.v1";
export const BB_PREFERENCES_MIRROR_STORAGE_KEY = "bb.thread-list.preferences.v1";

export function parseClientPreferences(raw: unknown): ClientPreferences {
  const result = clientPreferencesSchema.safeParse(raw ?? {});
  return result.success ? result.data : { filter: "all", density: "compact" };
}

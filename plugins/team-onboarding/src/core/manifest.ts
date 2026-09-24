// The team manifest (`onboarding.yaml`): schema, parsing and validation.
//
// The zod schema is the single source of truth. `schema/onboarding.schema.json`
// is emitted from it (`npm run schema`) so editors can validate the file too.
// Parsing keeps YAML node positions so every error names the line it is on.
import { isMap, isSeq, LineCounter, parseDocument, type Node } from "yaml";
import { z } from "zod";
import { isAllowedSourceUrl, isInternalHost } from "./netguard.js";
import { isVersionProbe, VERSION_PROBE_HINT } from "./probes.js";

/** Stable ids are what the plugin stores and logs; never URLs. */
const idSchema = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9._-]{0,63}$/,
    "ids use lowercase letters, digits, '.', '_' or '-' (at most 64)",
  );

/** Where an item runs: the server machine, every persistent machine, or named machines. */
export const machineRuleSchema = z.union([
  z.literal("server"),
  z.literal("all"),
  z.array(z.string().min(1)).min(1),
]);
export type MachineRule = z.infer<typeof machineRuleSchema>;

/** `owner/repo` on the manifest's GitHub host. */
const repoSchema = z
  .string()
  .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, "use owner/repo");

const gitUrlSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      /^(https:\/\/|ssh:\/\/|git@[^:]+:|file:\/\/|\/)/.test(value),
    "use an https://, ssh://, git@host: or file:// URL",
  )
  .refine(isAllowedSourceUrl, "that host is this machine or a private network address");

/** A reasonable git ref: branch, tag or commit SHA. */
const refSchema = z
  .string()
  .min(1)
  .max(255)
  .refine((value) => !/\s|\.\.|^-/.test(value), "not a valid git ref");

/** A command from the team: shown verbatim and run only after approval. */
const commandSchema = z.string().min(1).max(4000);

/**
 * A command typed into a terminal for the engineer to run. One line only: a
 * newline would run the text before it without the engineer pressing Enter.
 */
const typedCommandSchema = commandSchema.refine((value) => !/[\r\n]/.test(value), "must be one line");

/** Links the page opens: https only, never javascript: or data:. */
const httpsUrlSchema = z
  .string()
  .url()
  .refine((value) => value.startsWith("https://"), "use an https:// link");

/** A path inside the repository: relative, no `..`. */
const repoPathSchema = z
  .string()
  .min(1)
  .refine((value) => !value.startsWith("/") && !value.split(/[\\/]/).includes(".."), "use a path inside the repository, without ..");

const settingValueSchema = z.union([z.string(), z.number(), z.boolean()]);

const accessSchema = z
  .object({
    id: idSchema,
    repo: repoSchema,
    title: z.string().optional(),
    required: z.boolean().optional(),
    machines: machineRuleSchema.optional(),
  })
  .strict();

const githubSchema = z
  .object({
    host: z
      .string()
      .regex(/^[a-z0-9.-]+$/i, "a host name such as github.com")
      .refine((value) => !isInternalHost(value), "that host is this machine or a private network address")
      .default("github.com"),
    mode: z.enum(["builtin", "per-machine"]).default("builtin"),
    scopes: z.array(z.string().regex(/^[a-z:_]+$/)).default([]),
    signing: z
      .object({ required: z.boolean().default(false) })
      .strict()
      .optional(),
    access: z.array(accessSchema).default([]),
    machines: machineRuleSchema.optional(),
  })
  .strict();

const sshSchema = z
  .object({
    /** Turn the SSH group on even when nothing else needs it. */
    enabled: z.boolean().default(true),
    required: z.boolean().optional(),
    machines: machineRuleSchema.optional(),
  })
  .strict();

const providerSchema = z
  .object({
    id: z.string().min(1),
    required: z.boolean().optional(),
    machines: machineRuleSchema.optional(),
  })
  .strict();

const skillBase = {
  id: idSchema,
  title: z.string().optional(),
  required: z.boolean().optional(),
};

const gitSkillSchema = z
  .object({
    ...skillBase,
    source: z.literal("git"),
    url: gitUrlSchema,
    ref: refSchema.default("main"),
    paths: z.array(z.string().min(1)).min(1).default(["skills/*"]),
    exclude: z.array(z.string().min(1)).default([]),
  })
  .strict();

const apmSkillSchema = z
  .object({
    ...skillBase,
    source: z.literal("apm"),
    /** A repo holding the team's `apm.yml`… */
    url: gitUrlSchema.optional(),
    ref: refSchema.optional(),
    path: repoPathSchema.default("apm.yml"),
    /** …or one APM package reference, `owner/repo[/subpath][#ref]`. */
    package: z.string().min(1).optional(),
  })
  .strict()
  .refine(
    (value) => (value.url === undefined) !== (value.package === undefined),
    "an apm source needs exactly one of url (with path) or package",
  );

const registrySkillSchema = z
  .object({
    ...skillBase,
    source: z.literal("registry"),
    registrySkillId: z
      .string()
      .regex(/^[^/\s]+\/[^/\s]+(\/[^/\s]+)*$/, "use <source>/<skillId>")
      // The last segment becomes a folder name in the skill root.
      .refine((value) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.split("/").pop() ?? ""), "the skill id must be lowercase words joined by hyphens"),
  })
  .strict();

const pluginSourceSchema = z
  .string()
  .min(1)
  .refine(
    (value) => /^(git:|npm:|https:\/\/)/.test(value) || /^[a-z0-9-]+@[a-z0-9-]+$/.test(value),
    "use git:<url>[@ref], npm:<name>@<version>, https://… or <entry>@<marketplace>",
  );

const pluginSkillSchema = z
  .object({
    ...skillBase,
    source: z.literal("plugin"),
    install: pluginSourceSchema,
  })
  .strict();

const skillSchema = z.discriminatedUnion("source", [
  gitSkillSchema,
  apmSkillSchema,
  registrySkillSchema,
  pluginSkillSchema,
]);

const pluginSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().optional(),
    install: pluginSourceSchema,
    required: z.boolean().optional(),
    /** Non-secret values to preset. Secret settings are never listed here. */
    settings: z.record(z.string(), settingValueSchema).optional(),
  })
  .strict();

const marketplaceSchema = z
  .object({
    id: idSchema,
    source: z.string().min(1),
    required: z.boolean().optional(),
  })
  .strict();

const toolSchema = z
  .object({
    id: idSchema,
    title: z.string().optional(),
    check: z
      .object({
        bin: z
          .string()
          .regex(/^[A-Za-z0-9._+-]+$/, "bin must be a bare program name found on PATH"),
        args: z.array(z.string()).default(["--version"]),
        pattern: z.string().default("(\\d+\\.\\d+(?:\\.\\d+)?)"),
      })
      .strict(),
    min: z
      .string()
      .regex(/^\d+(\.\d+){0,2}$/, "min is a version like 2, 2.60 or 2.60.1")
      .optional(),
    hint: httpsUrlSchema.optional(),
    install: typedCommandSchema.optional(),
    required: z.boolean().optional(),
    machines: machineRuleSchema.optional(),
  })
  .strict()
  .superRefine((tool, ctx) => {
    if (!isVersionProbe(tool.check.bin, tool.check.args)) {
      ctx.addIssue({ code: "custom", path: ["check", "args"], message: VERSION_PROBE_HINT });
    }
  });

const envSchema = z
  .object({
    name: z
      .string()
      .regex(/^[A-Z_][A-Z0-9_]*$/, "env names are UPPER_SNAKE_CASE"),
    note: z.string().optional(),
    required: z.boolean().optional(),
  })
  .strict();

const checkFixSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("run"), command: commandSchema }).strict(),
  z.object({ kind: z.literal("terminal"), command: typedCommandSchema }).strict(),
]);

const teamCheckSchema = z
  .object({
    id: idSchema,
    title: z.string().min(1),
    description: z.string().optional(),
    run: commandSchema,
    fix: checkFixSchema.optional(),
    required: z.boolean().optional(),
    machines: machineRuleSchema.optional(),
  })
  .strict();

export const manifestSchema = z
  .object({
    $schema: z.string().optional(),
    schema: z.literal(1),
    team: z
      .object({
        name: z.string().min(1),
        docsUrl: httpsUrlSchema.optional(),
      })
      .strict(),
    machines: machineRuleSchema.default("all"),
    github: githubSchema.default({
      host: "github.com",
      mode: "builtin",
      scopes: [],
      access: [],
    }),
    ssh: sshSchema.optional(),
    providers: z.array(providerSchema).default([]),
    skills: z.array(skillSchema).default([]),
    plugins: z.array(pluginSchema).default([]),
    marketplaces: z.array(marketplaceSchema).default([]),
    tools: z.array(toolSchema).default([]),
    env: z.array(envSchema).default([]),
    checks: z.array(teamCheckSchema).default([]),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    const seen = new Map<string, string>();
    const claim = (key: string, path: (string | number)[]) => {
      if (seen.has(key)) {
        ctx.addIssue({
          code: "custom",
          path,
          message: `duplicate id "${key.split(":").slice(1).join(":")}"`,
        });
      }
      seen.set(key, path.join("."));
    };
    manifest.skills.forEach((s, i) => claim(`skill:${s.id}`, ["skills", i, "id"]));
    manifest.plugins.forEach((p, i) => claim(`plugin:${p.id}`, ["plugins", i, "id"]));
    manifest.marketplaces.forEach((m, i) =>
      claim(`marketplace:${m.id}`, ["marketplaces", i, "id"]),
    );
    manifest.tools.forEach((t, i) => claim(`tool:${t.id}`, ["tools", i, "id"]));
    manifest.env.forEach((e, i) => claim(`env:${e.name}`, ["env", i, "name"]));
    manifest.checks.forEach((c, i) => claim(`check:${c.id}`, ["checks", i, "id"]));
    manifest.providers.forEach((p, i) =>
      claim(`provider:${p.id}`, ["providers", i, "id"]),
    );
    manifest.github.access.forEach((a, i) =>
      claim(`access:${a.id}`, ["github", "access", i, "id"]),
    );
    manifest.tools.forEach((tool, i) => {
      try {
        new RegExp(tool.check.pattern);
      } catch {
        ctx.addIssue({
          code: "custom",
          path: ["tools", i, "check", "pattern"],
          message: "pattern is not a valid regular expression",
        });
      }
    });
  });

export type Manifest = z.infer<typeof manifestSchema>;
export type SkillSource = Manifest["skills"][number];
export type ToolEntry = Manifest["tools"][number];
export type TeamCheck = Manifest["checks"][number];
export type PluginEntry = Manifest["plugins"][number];
export type AccessEntry = Manifest["github"]["access"][number];

/** One readable validation problem, located in the file. */
export interface ManifestIssue {
  message: string;
  path: string;
  line: number | null;
}

export type ManifestParseResult =
  | { ok: true; manifest: Manifest }
  | { ok: false; issues: ManifestIssue[] };

const MAX_MANIFEST_BYTES = 256 * 1024;

/** Parses and validates manifest text. Never throws. */
export function parseManifest(text: string): ManifestParseResult {
  if (Buffer.byteLength(text, "utf8") > MAX_MANIFEST_BYTES) {
    return {
      ok: false,
      issues: [{ message: "the manifest is larger than 256 KiB", path: "", line: null }],
    };
  }
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter, prettyErrors: false });
  if (doc.errors.length > 0) {
    return {
      ok: false,
      issues: doc.errors.slice(0, 20).map((error) => ({
        message: error.message.split("\n")[0] ?? "YAML syntax error",
        path: "",
        line: lineCounter.linePos(error.pos[0]).line,
      })),
    };
  }
  const data: unknown = doc.toJS({ maxAliasCount: 50 });
  const parsed = manifestSchema.safeParse(data);
  if (parsed.success) return { ok: true, manifest: parsed.data };
  const issues = parsed.error.issues.slice(0, 50).map((issue) => {
    const path = issue.path.filter(
      (segment): segment is string | number =>
        typeof segment === "string" || typeof segment === "number",
    );
    return {
      message: describeIssue(issue, data, path),
      path: formatPath(path),
      line: lineOf(doc.contents, path, lineCounter),
    };
  });
  return { ok: false, issues };
}

function describeIssue(
  issue: z.core.$ZodIssue,
  data: unknown,
  path: (string | number)[],
): string {
  if (issue.code === "invalid_union" && "note" in issue && issue.note === "No matching discriminator") {
    const parent = valueAt(data, path.slice(0, -1));
    const key = path[path.length - 1];
    const got =
      parent && typeof parent === "object" && key !== undefined
        ? (parent as Record<string | number, unknown>)[key]
        : undefined;
    return `unknown ${String(key)} ${JSON.stringify(got)}`;
  }
  if (issue.code === "unrecognized_keys") {
    return `unknown field${issue.keys.length > 1 ? "s" : ""} ${issue.keys.map((k) => `"${k}"`).join(", ")}`;
  }
  if (issue.code === "invalid_type" && path[path.length - 1] === "check") {
    return "check must be { bin, args, pattern }, not a shell string";
  }
  return issue.message;
}

function valueAt(data: unknown, path: (string | number)[]): unknown {
  let current = data;
  for (const segment of path) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string | number, unknown>)[segment];
  }
  return current;
}

function formatPath(path: (string | number)[]): string {
  return path
    .map((segment, index) =>
      typeof segment === "number" ? `[${segment}]` : index === 0 ? segment : `.${segment}`,
    )
    .join("");
}

/** The 1-based line of the deepest YAML node on `path` that exists. */
function lineOf(
  root: unknown,
  path: (string | number)[],
  lineCounter: LineCounter,
): number | null {
  let node = root as Node | null;
  let best: number | null = rangeLine(node, lineCounter);
  for (const segment of path) {
    if (isMap(node)) {
      const pair = node.items.find(
        (item) => (item.key as { value?: unknown } | null)?.value === segment,
      );
      if (pair === undefined) break;
      best = rangeLine(pair.key as Node, lineCounter) ?? best;
      node = pair.value as Node | null;
      best = rangeLine(node, lineCounter) ?? best;
    } else if (isSeq(node) && typeof segment === "number") {
      node = (node.items[segment] as Node | undefined) ?? null;
      if (node === null) break;
      best = rangeLine(node, lineCounter) ?? best;
    } else {
      break;
    }
  }
  return best;
}

function rangeLine(node: Node | null, lineCounter: LineCounter): number | null {
  const start = node?.range?.[0];
  return start === undefined ? null : lineCounter.linePos(start).line;
}

/** Summary line used by the manifest card: "Found 14 items for Platform". */
export function formatIssue(issue: ManifestIssue): string {
  const where = issue.line === null ? "" : `line ${issue.line}: `;
  const field = issue.path === "" ? "" : `${issue.path}: `;
  return `${where}${field}${issue.message}`;
}

/** The emitted JSON Schema for editors. */
export function manifestJsonSchema(): unknown {
  return z.toJSONSchema(manifestSchema, { io: "input", unrepresentable: "any" });
}

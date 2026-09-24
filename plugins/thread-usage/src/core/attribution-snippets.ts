/** Harness labels and setup snippets, shared with the frontend. */

export const HARNESS_LABEL: Record<string, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  pi: "pi",
};

/** The config line each harness needs to tag its requests. */
export const SETUP_SNIPPETS = {
  codex: {
    file: "~/.codex/config.toml, in your gateway [model_providers.<id>] table",
    snippet: 'env_http_headers = { "x-litellm-session-id" = "BB_USAGE_SESSION" }',
  },
  pi: {
    file: "~/.pi/agent/models.json, in your gateway provider",
    snippet: '"headers": { "x-litellm-session-id": "!printf %s \\"${BB_USAGE_SESSION:-none}\\"" }',
  },
} as const;

// @vitest-environment jsdom
import { cleanup, fireEvent, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

afterEach(() => cleanup());
import { loadPluginApp, renderSlot, type CapturedPluginApp } from "@get-bb/plugin-sdk/testing/app";
import type { ItemState, OnboardingState, OnboardingSummary } from "../src/contract/rpc.js";
import type { Fix, FixKind, Status } from "../src/core/vocab.js";

let app: CapturedPluginApp;

beforeAll(async () => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  });
  // jsdom has no ResizeObserver; the inline terminal only needs it to exist.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  app = await loadPluginApp(() => import("../app.js"));
});

const fix = (kind: FixKind, label: string, extra: Partial<Fix> = {}): Fix => ({
  kind,
  label,
  command: null,
  url: null,
  safe: false,
  approvalHash: null,
  confirm: null,
  ...extra,
});

function row(id: string, group: ItemState["group"], status: Status, extra: Partial<ItemState> = {}): ItemState {
  return {
    id,
    group,
    title: id,
    why: `Why ${id}`,
    required: true,
    estimate: "~1 min",
    status,
    results: [{ itemId: id, hostId: "h1", status, category: status, checkedAt: null, detail: `Detail ${id}`, facts: {} }],
    fixes: [],
    commands: [],
    ...extra,
  } as ItemState;
}

function makeState(overrides: Partial<OnboardingState> = {}): OnboardingState {
  return {
    manifest: { status: "none", teamName: null, version: null, loadedAt: null, error: null, path: "/var/lib/bb/.bb/team-onboarding/onboarding.yaml", githubMode: "builtin", docsUrl: null },
    machines: [{ id: "h1", name: "server", isServer: true, online: true, lastSeenAt: null, hostEntry: true, longOffline: false }],
    items: [
      row("github.login", "github", "todo", { title: "Log in to GitHub", fixes: [{ hostId: "h1", fixes: [fix("device-login", "Log in with GitHub")] }] }),
      row("agent:claude-code", "agents", "todo", { title: "Claude Code" }),
    ],
    badge: { kind: "count", count: 2 },
    progress: { done: 0, total: 2 },
    nextStep: { itemId: "github.login", hostId: "h1" },
    homeLine: "2 setup steps left",
    doneSummary: "",
    lastCheckAt: null,
    running: false,
    account: { login: null },
    deviceLogin: null,
    safeFixes: [],
    terminals: [],
    watching: [],
    ...overrides,
  } as OnboardingState;
}

const panel = () => app.navPanels[0]!;

/** Stubs the browser-only actions route and records what the page posts. */
function stubActions(reply: Record<string, unknown> = { ok: true, message: null }) {
  const posted: { url: string; body: Record<string, unknown> }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    posted.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify(reply), { status: 200 });
  }) as typeof fetch;
  return posted;
}

describe("registrations", () => {
  it("registers the Onboarding page with its badge, header and one fixed tab, the home section and settings", () => {
    expect(panel()).toMatchObject({ id: "onboarding", title: "Onboarding", path: "onboarding" });
    expect(panel().experimental_sidebarAccessory).toBeDefined();
    expect(panel().headerContent).toBeDefined();
    // Terminals show under their item; only the team manifest has a tab.
    expect(panel().fixedTabs!.map((tab) => [tab.id, tab.title, tab.icon, tab.layout ?? "padded"])).toEqual([["manifest", "Team manifest", "FileText", "padded"]]);
    expect(app.homepageSections[0]).toMatchObject({ id: "setup", title: "Setup" });
    expect(app.settingsSections[0]).toMatchObject({ title: "Manifest file" });
  });
});

describe("Onboarding page", () => {
  // Acceptance 1: grey rows, the Next step card and the manifest card; not red.
  it("shows a fresh server as To do with one next step, and no manifest as one quiet line", async () => {
    const slot = renderSlot(panel(), { subPath: "" }, { rpc: { state: () => makeState() } as never });
    expect(await slot.findByText("Next step")).toBeTruthy();
    // No manifest is not a step: one line at the end, and how to add one folded away.
    expect(slot.queryByText("No team manifest on this server yet")).toBeNull();
    expect(slot.getByText("No team manifest on this server, so only the built-in checks run.")).toBeTruthy();
    const admins = slot.getByText("For admins: how to add one").closest("details")!;
    expect(admins.open).toBe(false);
    expect(within(admins as HTMLElement).getByText("/var/lib/bb/.bb/team-onboarding/onboarding.yaml")).toBeTruthy();
    expect(within(admins as HTMLElement).getByText("bb team-onboarding manifest install ./onboarding.yaml")).toBeTruthy();
    expect(within(admins as HTMLElement).getByRole("button", { name: /Copy/, hidden: true })).toBeTruthy();
    expect(slot.getAllByText("To do").length).toBe(2);
    expect(slot.queryByText("Broken")).toBeNull();
    expect(slot.getAllByRole("button", { name: "Log in with GitHub" }).length).toBeGreaterThan(0);
  });

  it("shows a manifest file that can't be used as a problem, with where it is", async () => {
    const state = makeState({
      manifest: { ...makeState().manifest, status: "error", error: "line 2: team.name: Required" },
      items: [row("core.manifest", "team", "broken", { title: "Your team's manifest" })],
      nextStep: { itemId: "core.manifest", hostId: "h1" },
    });
    const slot = renderSlot(panel(), { subPath: "" }, { rpc: { state: () => state } as never });
    expect(await slot.findByText("The team manifest on this server can't be used")).toBeTruthy();
    expect(slot.getByRole("alert").textContent).toBe("line 2: team.name: Required");
    expect(slot.queryByText("No team manifest on this server, so only the built-in checks run.")).toBeNull();
  });

  it("is all set with only the built-in checks when there is no manifest", async () => {
    const state = makeState({
      items: [row("github.login", "github", "ok")],
      badge: { kind: "done" },
      progress: { done: 1, total: 1 },
      nextStep: null,
      doneSummary: "Claude Code on 1 machine",
    });
    const slot = renderSlot(panel(), { subPath: "" }, { rpc: { state: () => state } as never });
    expect(await slot.findByText("You're set up")).toBeTruthy();
    expect(slot.queryByText("Next step")).toBeNull();
  });

  it("runs the next step's fix", async () => {
    const posted = stubActions({ ok: true, message: null, terminal: null, loginId: "l1" });
    const slot = renderSlot(panel(), { subPath: "" }, { rpc: { state: () => makeState() } as never });
    const [button] = await slot.findAllByRole("button", { name: "Log in with GitHub" });
    fireEvent.click(button!);
    await slot.findByText("Next step");
    await new Promise((resolve) => setTimeout(resolve, 20));
    // A login is not a safe fix: it goes through the page-only route, not RPC.
    expect(posted[0]).toMatchObject({ url: "/api/v1/plugins/team-onboarding/http/actions", body: { action: "runFix", kind: "device-login" } });
    expect(slot.inspection.rpcCalls.some((call) => call.method === "runFix")).toBe(false);
  });

  // Acceptance 2 (UI): the code in large type with Copy and the GitHub link.
  it("shows the device code with a countdown", async () => {
    const state = makeState({
      deviceLogin: {
        loginId: "l1",
        hostId: "h1",
        itemId: "github.login",
        flow: "login",
        state: "code",
        code: "WXYZ-1234",
        url: "https://github.com/login/device",
        expiresAt: new Date(Date.now() + 14 * 60_000).toISOString(),
        message: null,
      },
    });
    const slot = renderSlot(panel(), { subPath: "" }, { rpc: { state: () => state } as never });
    expect((await slot.findByLabelText("One-time code")).textContent).toBe("WXYZ-1234");
    expect(slot.getByRole("button", { name: /Copy code/ })).toBeTruthy();
    expect(slot.getByRole("button", { name: /Open github.com\/login\/device/ })).toBeTruthy();
    expect(slot.getByText(/Code expires in 1[34]:\d\d/)).toBeTruthy();
  });

  it("offers Get a new code when the code expired", async () => {
    const state = makeState({
      deviceLogin: { loginId: "l1", hostId: "h1", itemId: "github.login", flow: "login", state: "expired", code: "WXYZ-1234", url: null, expiresAt: null, message: null },
    });
    const slot = renderSlot(panel(), { subPath: "" }, { rpc: { state: () => state } as never });
    expect(await slot.findByRole("button", { name: "Get a new code" })).toBeTruthy();
  });

  it("says the GitHub login is gh auth login on the machine where agents run", async () => {
    const slot = renderSlot(panel(), { subPath: "" }, { rpc: { state: () => makeState() } as never });
    const note = await slot.findByText(/you'd run in a terminal/);
    expect(note.textContent).toBe("This is the same gh auth login you'd run in a terminal, on server where agents run — not your laptop.");
  });

  it("names the machine while a code is shown, and the account when the login is done", async () => {
    const running = makeState({
      deviceLogin: { loginId: "l1", hostId: "h1", itemId: "github.login", flow: "login", state: "starting", code: null, url: null, expiresAt: null, message: null },
    });
    let slot = renderSlot(panel(), { subPath: "" }, { rpc: { state: () => running } as never });
    expect((await slot.findByText(/where agents run\.$/)).textContent).toBe("This runs gh auth login on server, where agents run.");
    cleanup();
    const message = "Logged in on server as @octo. gh couldn't save its settings file (config.yml is read-only here); your login is saved. git uses it for HTTPS. Agents still act as @token-user: GH_TOKEN takes precedence while it is set.";
    const done = makeState({
      deviceLogin: { loginId: "l1", hostId: "h1", itemId: "github.login", flow: "login", state: "done", code: null, url: null, expiresAt: null, message },
    });
    slot = renderSlot(panel(), { subPath: "" }, { rpc: { state: () => done } as never });
    expect(await slot.findByText(message)).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "Dismiss" }));
    expect(slot.queryByText(message)).toBeNull();
  });

  it("shows what to add to a file managed outside bb, with Copy", async () => {
    const addThere = "[core]\n\tsshCommand = ssh -F '/home/me/.ssh/bb_config'";
    const state = makeState({
      items: [
        row("ssh.config", "ssh", "todo", {
          title: "SSH config",
          results: [{ itemId: "ssh.config", hostId: "h1", status: "todo", category: "read-only", checkedAt: null, detail: "Managed outside bb: ~/.config/git/config is read-only. Add the lines below where you manage it.", facts: { addThere } }],
          fixes: [{ hostId: "h1", fixes: [fix("copy-text", "Copy what to add", { command: addThere })] }],
        }),
      ],
      nextStep: null,
    });
    const slot = renderSlot(panel(), { subPath: "" }, { rpc: { state: () => state } as never });
    fireEvent.click((await slot.findAllByText("Managed outside bb: ~/.config/git/config is read-only. Add the lines below where you manage it."))[0]!);
    expect((await slot.findByText(/sshCommand = ssh -F/)).tagName).toBe("PRE");
    expect(slot.getAllByRole("button", { name: "Copy what to add" }).length).toBeGreaterThan(0);
  });

  // Acceptance 17 (UI): the command is shown verbatim and approved in the UI.
  it("shows team commands verbatim with Approve", async () => {
    const state = makeState({
      manifest: { ...makeState().manifest, status: "ok", teamName: "Example Platform" },
      items: [
        row("check:vpn", "team", "needs-approval", {
          title: "VPN",
          commands: [{ role: "run", text: "curl -sfm5 https://internal.example.com/health", ref: null, hash: "a".repeat(32), approved: false }],
          fixes: [{ hostId: "h1", fixes: [fix("approve", "Review and approve", { command: "curl", approvalHash: "a".repeat(32) })] }],
        }),
      ],
      nextStep: null,
      badge: { kind: "count", count: 1 },
    });
    const posted = stubActions();
    const slot = renderSlot(panel(), { subPath: "" }, { rpc: { state: () => state } as never });
    expect(await slot.findByText("Commands from your team")).toBeTruthy();
    expect(slot.getByText("curl -sfm5 https://internal.example.com/health")).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "Approve" }));
    await slot.findByText("Commands from your team");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(posted).toEqual([{ url: "/api/v1/plugins/team-onboarding/http/actions", body: { action: "approve", hash: "a".repeat(32) } }]);
    expect(slot.inspection.rpcCalls.some((call) => call.method === "approve")).toBe(false);
  });

  it("refuses approvals from an automated browser", async () => {
    const state = makeState({
      items: [
        row("check:vpn", "team", "needs-approval", {
          title: "VPN",
          commands: [{ role: "run", text: "true", ref: null, hash: "b".repeat(32), approved: false }],
        }),
      ],
      nextStep: null,
    });
    const posted = stubActions();
    Object.defineProperty(navigator, "webdriver", { configurable: true, get: () => true });
    try {
      const slot = renderSlot(panel(), { subPath: "" }, { rpc: { state: () => state } as never });
      fireEvent.click(await slot.findByRole("button", { name: "Approve" }));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(posted).toEqual([]);
    } finally {
      Object.defineProperty(navigator, "webdriver", { configurable: true, get: () => false });
    }
  });

  it("shows a fix's terminal under its item, with what runs where, its status and Close", async () => {
    const terminal = (overrides: Record<string, unknown>) => ({
      terminalId: "t1",
      hostId: "h1",
      itemId: "agent:claude-code",
      title: "Log in: Claude Code",
      command: "claude /login",
      status: "running",
      exitCode: null,
      ...overrides,
    });
    const running = makeState({
      items: [row("agent:claude-code", "agents", "todo", { title: "Claude Code" }), row("github.login", "github", "todo", { title: "Log in to GitHub" })],
      nextStep: null,
      terminals: [terminal({}), terminal({ terminalId: "t2", itemId: "github.login", command: "gh auth refresh", status: "exited", exitCode: 1 })],
    });
    const posted = stubActions();
    const slot = renderSlot(panel(), { subPath: "" }, { rpc: { state: () => running } as never });
    const claude = await slot.findByRole("region", { name: "Terminal: claude /login" });
    expect(claude.textContent).toContain("Running claude /login on server");
    expect(claude.textContent).toContain("running");
    expect(claude.closest("[data-item]")?.getAttribute("data-item")).toBe("agent:claude-code");
    // Each terminal stays under its own item, with its own status.
    const gh = slot.getByRole("region", { name: "Terminal: gh auth refresh" });
    expect(gh.closest("[data-item]")?.getAttribute("data-item")).toBe("github.login");
    expect(gh.textContent).toContain("Ran gh auth refresh on server");
    expect(gh.textContent).toContain("failed · exit 1");
    fireEvent.click(within(claude).getByRole("button", { name: "Close terminal: claude /login" }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(posted[0]!.body).toEqual({ action: "closeTerminal", terminalId: "t1" });
    // No standing terminal tab and no free shell.
    expect(slot.queryByRole("button", { name: /New shell/ })).toBeNull();
  });

  it("lists terminals no item owns, and keeps a done group open while its terminal runs", async () => {
    const state = makeState({
      items: [row("agent:claude-code", "agents", "ok", { title: "Claude Code" })],
      nextStep: null,
      terminals: [
        { terminalId: "t1", hostId: "h1", itemId: "agent:claude-code", title: "Log in", command: "claude /login", status: "running", exitCode: null },
        { terminalId: "old", hostId: "h1", itemId: null, title: "Shell", command: null, status: "running", exitCode: null },
        { terminalId: "gone-item", hostId: "h1", itemId: "tool:removed", title: "Install", command: "brew install x", status: "exited", exitCode: 0 },
      ],
    });
    const posted = stubActions();
    const slot = renderSlot(panel(), { subPath: "" }, { rpc: { state: () => state } as never });
    const others = await slot.findByRole("region", { name: "Other setup terminals" });
    expect(within(others).getByRole("region", { name: "Terminal: Shell" })).toBeTruthy();
    expect(within(others).getByRole("region", { name: "Terminal: brew install x" })).toBeTruthy();
    // The Agents group is all done, but its running terminal keeps it open.
    expect(slot.getByRole("region", { name: "Terminal: claude /login" }).closest("[data-item]")?.getAttribute("data-item")).toBe("agent:claude-code");
    fireEvent.click(within(others).getByRole("button", { name: "Close terminal: Shell" }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(posted[0]!.body).toEqual({ action: "closeTerminal", terminalId: "old" });
  });

  // Acceptance 26 (UI): You're set up.
  it("shows the done state", async () => {
    const state = makeState({
      manifest: { ...makeState().manifest, status: "ok", teamName: "Example Platform" },
      items: [row("github.login", "github", "ok")],
      badge: { kind: "done" },
      nextStep: null,
      doneSummary: "3 team skills, Claude Code and Codex on 2 machines",
    });
    const slot = renderSlot(panel(), { subPath: "" }, { rpc: { state: () => state } as never });
    expect(await slot.findByText("You're set up")).toBeTruthy();
    expect(slot.getByText("3 team skills, Claude Code and Codex on 2 machines")).toBeTruthy();
  });

  it("shows an offline machine as dimmed, never red", async () => {
    const state = makeState({
      machines: [
        { id: "h1", name: "server", isServer: true, online: true, lastSeenAt: null, hostEntry: true, longOffline: false },
        { id: "h2", name: "laptop", isServer: false, online: false, lastSeenAt: new Date(Date.now() - 2 * 3600_000).toISOString(), hostEntry: true, longOffline: false },
      ],
      items: [
        {
          ...row("tool:gh", "tools", "unknown"),
          results: [
            { itemId: "tool:gh", hostId: "h1", status: "skipped", category: "out-of-scope", checkedAt: null, detail: "", facts: {} },
            { itemId: "tool:gh", hostId: "h2", status: "unknown", category: "offline", checkedAt: null, detail: "Can't check, laptop is offline.", facts: {} },
          ],
        },
      ],
      nextStep: null,
    });
    const slot = renderSlot(panel(), { subPath: "" }, { rpc: { state: () => state } as never });
    expect(await slot.findByText(/Can't check, laptop offline · last seen 2 h ago/)).toBeTruthy();
  });
});

describe("badge and home section", () => {
  const summary = (badge: OnboardingSummary["badge"], homeLine: string): OnboardingSummary => ({
    badge,
    homeLine,
    hasBlocking: badge.kind === "count",
    hasUpdates: badge.kind === "dot",
    lastCheckAt: null,
  });

  it("shows the count, a dot for updates, or a check mark", async () => {
    const accessory = { component: panel().experimental_sidebarAccessory! };
    const count = renderSlot(accessory, {}, { rpc: { summary: () => summary({ kind: "count", count: 3 }, "3 setup steps left") } as never });
    expect((await count.findByLabelText("3 setup steps left")).textContent).toBe("3");
    count.lifecycle.unmount();
    const dot = renderSlot(accessory, {}, { rpc: { summary: () => summary({ kind: "dot", updates: 1 }, "1 update available") } as never });
    expect(await dot.findByLabelText("Updates available")).toBeTruthy();
    dot.lifecycle.unmount();
    const done = renderSlot(accessory, {}, { rpc: { summary: () => summary({ kind: "done" }, "All set") } as never });
    expect(await done.findByLabelText("All set")).toBeTruthy();
  });

  it("reads '3 setup steps left · Open Onboarding' and navigates", async () => {
    const slot = renderSlot(app.homepageSections[0]!, { projectId: null }, { rpc: { summary: () => summary({ kind: "count", count: 3 }, "3 setup steps left") } as never });
    expect(await slot.findByText("3 setup steps left")).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "Open Onboarding" }));
    expect(slot.inspection.navigateCalls[0]).toEqual({ method: "toPluginPanel", path: "onboarding" });
  });

  it("reads All set without a link", async () => {
    const slot = renderSlot(app.homepageSections[0]!, { projectId: null }, { rpc: { summary: () => summary({ kind: "done" }, "All set · checked 5 min ago") } as never });
    expect(await slot.findByText("All set · checked 5 min ago")).toBeTruthy();
    expect(slot.queryByRole("button", { name: "Open Onboarding" })).toBeNull();
  });
});

describe("settings section", () => {
  it("shows where the manifest file is, its hash, and its problems", async () => {
    const info = {
      path: "/var/lib/bb/.bb/team-onboarding/onboarding.yaml",
      exists: true,
      sha: "0123456789abcdef".repeat(4),
      mtime: new Date().toISOString(),
      issues: ["line 4: tools.0.check: check must be { bin, args, pattern }, not a shell string"],
    };
    const slot = renderSlot(app.settingsSections[0]!, {}, { rpc: { manifestFile: () => info } as never });
    expect(await slot.findByText(info.path)).toBeTruthy();
    expect(slot.getByText("0123456789ab")).toBeTruthy();
    expect(slot.getByText(info.issues[0]!)).toBeTruthy();
  });

  it("says when there is no file yet, and how to install one", async () => {
    const info = { path: "/var/lib/bb/.bb/team-onboarding/onboarding.yaml", exists: false, sha: null, mtime: null, issues: [] };
    const slot = renderSlot(app.settingsSections[0]!, {}, { rpc: { manifestFile: () => info } as never });
    expect(await slot.findByText(/Not there yet/)).toBeTruthy();
    expect(slot.getByText("bb team-onboarding manifest install ./onboarding.yaml")).toBeTruthy();
  });
});

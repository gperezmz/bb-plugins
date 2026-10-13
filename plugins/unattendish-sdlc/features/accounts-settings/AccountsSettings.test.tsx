// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fake, resetFakeApi } from "@/testing/api";
import { accountSetting, credentialSetting, settingsView } from "@/testing/fixtures";
import { drawnIcons, expectIconsResolve } from "@/testing/icons";
import { sdk } from "@/testing/sdk";
import { announceConnectSaved, closeConnect, currentConnect } from "@/shared/connect/requests";
import { AccountsSettings } from "./index";

vi.mock("@get-bb/plugin-sdk/app", async () => (await import("@/testing/sdk")).sdkModule());
vi.mock("@/shared/client", async (original) => (await import("@/testing/api")).withFakeClient(await original()));

const yuser = accountSetting({
  defaultFor: ["github.com"],
  addsOwners: true,
  credentials: [credentialSetting({ id: "cred_acme", reaches: "acme", expiresAt: "2026-10-18T12:00:00Z", fleets: ["acme/api"] })],
});
const buser = accountSetting({
  id: "acc_buser",
  label: "GitHub · buser",
  name: "buser",
  defaultFor: [],
  canMakeDefault: true,
  credentials: [credentialSetting({ id: "cred_zorg", reaches: "every owner on github.com", kindLabel: "classic token", kind: "classic", canWrite: true })],
  assignments: [{ scope: "github.com/other-org", what: "other-org" }],
});
const stored = settingsView({ accounts: [yuser, buser], fleets: [{ repo: "acme/web", forge: "github", intervalMs: 120_000, isDefault: false }] });

beforeEach(() => {
  sdk.reset();
  resetFakeApi();
  fake.api.settings.mockResolvedValue(stored);
});
afterEach(() => {
  cleanup();
  closeConnect();
});

const show = async () => {
  render(<AccountsSettings />);
  await screen.findByRole("heading", { name: "Accounts" });
};
const account = (label: string) => screen.getByRole("listitem", { name: label });
/** Opens an account's ⋯ menu from the keyboard, as Radix opens it, and returns the menu. */
const menuOf = async (label: string) => {
  fireEvent.keyDown(within(account(label)).getByRole("button", { name: `More for ${label}` }), { key: "Enter" });
  return screen.findByRole("menu");
};

describe("the accounts", () => {
  it("lists each account with its service, host, defaults, and its credentials with what they reach, their kind, expiry and fleets", async () => {
    await show();
    const first = account("GitHub · yuser");
    expect(within(first).getByText("github.com")).toBeTruthy();
    expect(within(first).getByLabelText("default for github.com").textContent).toBe("default");
    const credential = within(within(first).getByRole("list", { name: "Credentials of GitHub · yuser" })).getByRole("listitem");
    expect(within(credential).getByText("acme")).toBeTruthy();
    expect(within(credential).getByText("fine-grained token")).toBeTruthy();
    expect(within(credential).getByText("expires 18 Oct")).toBeTruthy();
    expect(within(credential).getByText("read by acme/api")).toBeTruthy();
    expect(within(account("GitHub · buser")).queryByLabelText(/default for/)).toBeNull();
  });

  it("has no JSON field on the page", async () => {
    await show();
    expect(screen.queryByRole("textbox", { name: /credentials|tokens/i })).toBeNull();
  });

  it("labels a credential that can write", async () => {
    await show();
    expect(within(account("GitHub · buser")).getByText("can write")).toBeTruthy();
    expect(within(account("GitHub · yuser")).queryByText("can write")).toBeNull();
  });

  it("says a credential reports no expiry", async () => {
    fake.api.settings.mockResolvedValue(settingsView({ accounts: [accountSetting({ credentials: [credentialSetting()] })] }));
    await show();
    expect(screen.getByText("no expiry reported")).toBeTruthy();
    expect(screen.getByText("no fleet reads with it")).toBeTruthy();
  });

  it("says when there is no account, and offers Add account", async () => {
    fake.api.settings.mockResolvedValue(settingsView());
    await show();
    expect(screen.getByText("No account is connected.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add account" }));
    expect(currentConnect()?.request).toEqual({ target: {} });
  });

  it("shows why an account's login cannot be used", async () => {
    fake.api.settings.mockResolvedValue(settingsView({ accounts: [accountSetting({ via: "gh", loginProblem: "gh is signed in as yuser, not buser" })] }));
    await show();
    expect(screen.getByText("gh is signed in as yuser, not buser")).toBeTruthy();
  });
});

describe("Make default and assignments", () => {
  it("makes another account of a host the default", async () => {
    await show();
    expect(within(account("GitHub · yuser")).queryByRole("button", { name: /Make/ })).toBeNull();
    fireEvent.click(within(account("GitHub · buser")).getByRole("button", { name: "Make GitHub · buser the default" }));
    await waitFor(() => expect(fake.api.makeDefault).toHaveBeenCalledWith({ accountId: "acc_buser" }));
    await waitFor(() => expect(fake.api.settings).toHaveBeenCalledTimes(2));
  });

  it("lists the owners assigned to an account, each with Remove, which returns it to the default", async () => {
    await show();
    const assigned = within(account("GitHub · buser")).getByRole("list", { name: "Assigned to GitHub · buser" });
    expect(within(assigned).getByText("other-org")).toBeTruthy();
    fireEvent.click(within(assigned).getByRole("button", { name: "Remove other-org from GitHub · buser" }));
    await waitFor(() => expect(fake.api.removeAssignment).toHaveBeenCalledWith({ scope: "github.com/other-org" }));
  });
});

describe("opening the popup", () => {
  it("opens Add token for another owner at the token step for a GitHub account", async () => {
    await show();
    fireEvent.click(within(await menuOf("GitHub · yuser")).getByRole("menuitem", { name: "Add token for another owner to GitHub · yuser" }));
    expect(currentConnect()?.request).toEqual({ target: { service: "github", place: "github.com" }, account: "acc_yuser" });
  });

  it("offers Add token for another owner only where the account holds owner tokens", async () => {
    fake.api.settings.mockResolvedValue(settingsView({ accounts: [accountSetting({ addsOwners: false, via: "gh" })] }));
    await show();
    expect(within(await menuOf("GitHub · yuser")).queryByRole("menuitem", { name: /another owner/ })).toBeNull();
  });
});

describe("Renew", () => {
  const expiring = (over = {}) => settingsView({ accounts: [accountSetting({ credentials: [credentialSetting({ expiresInDays: 6, expiresAt: "2026-10-18T12:00:00Z", ...over })] })] });

  it("warns of a token expiring soon and opens the pre-filled page's popup for its owner, replacing it", async () => {
    fake.api.settings.mockResolvedValue(expiring());
    await show();
    expect(screen.getByText("expires in 6 days")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Renew the token for acme of GitHub · yuser" }));
    expect(currentConnect()?.request).toEqual({ target: { service: "github", place: "github.com", owner: "acme" }, account: "acc_yuser", replaces: "cred_acme" });
  });

  it("opens the key's field for a key", async () => {
    fake.api.settings.mockResolvedValue(
      settingsView({ accounts: [accountSetting({ id: "acc_lin", label: "Linear · yuser", service: "linear", place: "linear.app", credentials: [credentialSetting({ reaches: "linear.app", kind: "linear-key", kindLabel: "API key", expiresInDays: 3, renew: { kind: "paste" } })] })] }),
    );
    await show();
    fireEvent.click(screen.getByRole("button", { name: /^Renew/ }));
    expect(currentConnect()?.request).toEqual({ target: { service: "linear", place: "linear.app" }, account: "acc_lin", replaces: "cred_acme" });
  });

  it("shows the command a gh login needs and offers no Renew", async () => {
    fake.api.settings.mockResolvedValue(expiring({ refused: true, kind: "gh", kindLabel: "gh login", renew: { kind: "login", command: "gh auth login --hostname github.com" } }));
    await show();
    expect(screen.getByText("gh auth login --hostname github.com")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Renew/ })).toBeNull();
  });

  it("says a refused credential is refused by the service, with Renew where one is given", async () => {
    fake.api.settings.mockResolvedValue(settingsView({ accounts: [accountSetting({ credentials: [credentialSetting({ refused: true })] })] }));
    await show();
    expect(screen.getByText("refused by the service")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Renew/ })).toBeTruthy();
  });

  it("offers nothing to renew on a credential that is neither expiring nor refused", async () => {
    await show();
    expect(screen.queryByRole("button", { name: /^Renew/ })).toBeNull();
  });
});

describe("Remove", () => {
  it("asks before removing a credential, and removes only on confirmation, then says the old token still works", async () => {
    fake.api.removeCredential.mockResolvedValue({ ok: true, settings: settingsView(), revoke: { text: "The old token still works at GitHub until it expires or you revoke it.", url: "https://github.com/settings/personal-access-tokens" } });
    await show();
    fireEvent.click(screen.getByRole("button", { name: "Remove the token for acme of GitHub · yuser" }));
    expect(fake.api.removeCredential).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect(fake.api.removeCredential).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Remove the token for acme of GitHub · yuser" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm removing the token for acme" }));
    await waitFor(() => expect(fake.api.removeCredential).toHaveBeenCalledWith({ credentialId: "cred_acme" }));
    expect(await screen.findByText(/The old token still works at GitHub/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open the token page/ }).getAttribute("href")).toBe("https://github.com/settings/personal-access-tokens");
  });

  it("removes an account on confirmation", async () => {
    await show();
    fireEvent.click(within(await menuOf("GitHub · yuser")).getByRole("menuitem", { name: "Remove GitHub · yuser" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm removing GitHub · yuser" }));
    await waitFor(() => expect(fake.api.removeAccount).toHaveBeenCalledWith({ accountId: "acc_yuser" }));
  });

  it("shows the refusal naming the fleets that read as the account", async () => {
    fake.api.removeAccount.mockResolvedValue({ ok: false, reason: "GitHub · buser is read by zorg/z" });
    await show();
    fireEvent.click(within(await menuOf("GitHub · buser")).getByRole("menuitem", { name: "Remove GitHub · buser" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm removing GitHub · buser" }));
    expect((await screen.findByRole("alert")).textContent).toBe("GitHub · buser is read by zorg/z");
    expect(screen.queryByText(/Remove GitHub · buser and all its tokens/)).toBeNull();
  });
});

describe("after the popup stored something", () => {
  it("refetches at once, and says the replaced token still works", async () => {
    await show();
    act(() => announceConnectSaved({ text: "The replaced token still works.", url: "https://github.com/settings/tokens" }));
    await waitFor(() => expect(fake.api.settings).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/The replaced token still works\./)).toBeTruthy();
  });
});

describe("the poll interval", () => {
  const field = () => screen.getByRole("textbox", { name: "Poll interval of acme/web, in seconds" });

  it("shows each fleet's interval in seconds", async () => {
    await show();
    expect((field() as HTMLInputElement).value).toBe("120");
  });

  it("refuses under 30 seconds in the field, sending nothing", async () => {
    await show();
    fireEvent.change(field(), { target: { value: "29" } });
    expect(screen.getByRole("alert").textContent).toBe("The poll interval must be at least 30 seconds.");
    expect((screen.getByRole("button", { name: "Set the poll interval of acme/web" }) as HTMLButtonElement).disabled).toBe(true);
    expect(fake.api.setInterval).not.toHaveBeenCalled();
  });

  it("sends a valid interval in seconds", async () => {
    await show();
    fireEvent.change(field(), { target: { value: "45" } });
    fake.api.setInterval.mockResolvedValue({ ok: true, settings: stored });
    fireEvent.click(screen.getByRole("button", { name: "Set the poll interval of acme/web" }));
    await waitFor(() => expect(fake.api.setInterval).toHaveBeenCalledWith({ repo: "acme/web", seconds: 45 }));
  });

  it("shows the server's refusal reason", async () => {
    await show();
    fireEvent.change(field(), { target: { value: "45" } });
    fake.api.setInterval.mockResolvedValue({ ok: false, reason: "the interval is under the service's floor" });
    fireEvent.click(screen.getByRole("button", { name: "Set the poll interval of acme/web" }));
    expect((await screen.findByRole("alert")).textContent).toBe("the interval is under the service's floor");
  });

  it("returns a fleet to the default", async () => {
    await show();
    fake.api.setInterval.mockResolvedValue({ ok: true, settings: stored });
    fireEvent.click(screen.getByRole("button", { name: "Reset the poll interval of acme/web to the default" }));
    await waitFor(() => expect(fake.api.setInterval).toHaveBeenCalledWith({ repo: "acme/web", seconds: null }));
  });
});

describe("the section's look", () => {
  const line = (reaches: string) => screen.getByText(reaches, { selector: "span" }).closest("li")!;

  it("heads each account's card with its logo, label, place and default, and puts the rare actions in a ⋯ menu (AC6)", async () => {
    await show();
    const first = account("GitHub · yuser");
    expect(drawnIcons(first).slice(0, 1)).toEqual(["GithubLogo"]);
    expect(within(first).getByLabelText("default for github.com").textContent).toBe("default");
    expect(within(first).queryByRole("button", { name: /^Make/ })).toBeNull();
    expect(within(account("GitHub · buser")).getByRole("button", { name: "Make GitHub · buser the default" })).toBeTruthy();
    expect(within(first).queryByRole("button", { name: "Remove GitHub · yuser" })).toBeNull();
    expect(drawnIcons(within(first).getByRole("button", { name: "More for GitHub · yuser" }))).toEqual(["MoreHorizontal"]);
    const menu = await menuOf("GitHub · yuser");
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Add token for another owner", "Remove account"]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Remove GitHub · yuser" }));
    expect(await screen.findByText("Remove GitHub · yuser and all its tokens?")).toBeTruthy();
    expect(fake.api.removeAccount).not.toHaveBeenCalled();
  });

  it("shows GitLab, Linear and Jira accounts by their names, which their trademark rules leave as the only mark (AC6)", async () => {
    fake.api.settings.mockResolvedValue(settingsView({ accounts: [accountSetting({ id: "acc_gl", label: "GitLab · yuser", service: "gitlab", place: "gitlab.com", credentials: [] })] }));
    await show();
    expect(drawnIcons(account("GitLab · yuser"))).toEqual(["MoreHorizontal"]);
    expect(within(account("GitLab · yuser")).getByText("GitLab · yuser")).toBeTruthy();
  });

  it("draws each token as a line with its key, reach, kind, readers and a 🗑 that asks first (AC7)", async () => {
    await show();
    const token = line("acme");
    expect(drawnIcons(token)).toEqual(["unattendish-sdlc/key", "Trash2"]);
    expect(within(token).getByText("fine-grained token")).toBeTruthy();
    expect(within(token).getByText("read by acme/api")).toBeTruthy();
    const expiry = within(token).getByText("expires 18 Oct");
    expect(expiry.className).toContain("text-muted-foreground");
    expect(within(token).queryByRole("button", { name: /^Renew/ })).toBeNull();
    fireEvent.click(within(token).getByRole("button", { name: "Remove the token for acme of GitHub · yuser" }));
    expect(screen.getByText("Remove the token for acme?")).toBeTruthy();
    expect(fake.api.removeCredential).not.toHaveBeenCalled();
  });

  it("reads 'expires in 3 days' in amber with a clock, beside Renew…, for a token expiring in 3 days (AC7)", async () => {
    fake.api.settings.mockResolvedValue(settingsView({ accounts: [accountSetting({ credentials: [credentialSetting({ expiresInDays: 3, expiresAt: "2026-10-15T12:00:00Z" })] })] }));
    await show();
    const expiry = screen.getByText("expires in 3 days");
    expect(expiry.className).toContain("text-warning-text");
    expect(drawnIcons(expiry)).toEqual(["Clock"]);
    expect(expiry.nextElementSibling!.textContent).toBe("Renew…");
  });

  it("reads 'expired 12 Oct' in red with a cross, beside Renew…, for a token that expired on 12 Oct, refused or not (#261 AC5)", async () => {
    for (const refused of [false, true]) {
      fake.api.settings.mockResolvedValue(settingsView({ accounts: [accountSetting({ credentials: [credentialSetting({ expired: true, refused, expiresAt: new Date(2026, 9, 12, 23, 0).toISOString() })] })] }));
      await show();
      const expiry = screen.getByText("expired 12 Oct");
      expect(expiry.className).toContain("text-destructive-text");
      expect(drawnIcons(expiry)).toEqual(["CircleX"]);
      expect(expiry.nextElementSibling!.textContent).toBe("Renew…");
      expect(screen.queryByText("refused by the service")).toBeNull();
      cleanup();
    }
  });

  it("keeps an expired gh login's sign-in command in place of Renew… (#261 AC5)", async () => {
    const login = credentialSetting({ expired: true, expiresAt: new Date(2026, 9, 12, 23, 0).toISOString(), renew: { kind: "login", command: "gh auth login --hostname github.com" } });
    fake.api.settings.mockResolvedValue(settingsView({ accounts: [accountSetting({ via: "gh", credentials: [login] })] }));
    await show();
    expect(screen.getByText("expired 12 Oct")).toBeTruthy();
    expect(screen.getByText(/gh auth login --hostname github.com/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Renew/ })).toBeNull();
  });

  it("shows a refused token in red with a cross, beside Renew… (AC7)", async () => {
    fake.api.settings.mockResolvedValue(settingsView({ accounts: [accountSetting({ credentials: [credentialSetting({ refused: true })] })] }));
    await show();
    const expiry = screen.getByText("refused by the service");
    expect(expiry.className).toContain("text-destructive-text");
    expect(drawnIcons(expiry)).toEqual(["CircleX"]);
    expect(expiry.nextElementSibling!.textContent).toBe("Renew…");
  });

  it("says a gh login shares the agents' rate limit, in amber, and keeps its sign-in command in place of Renew… (AC7)", async () => {
    fake.api.settings.mockResolvedValue(
      settingsView({ accounts: [accountSetting({ via: "gh", credentials: [credentialSetting({ reaches: "every owner on github.com", kind: "gh", kindLabel: "gh login", canWrite: true, refused: true, sharesRateLimit: true, renew: { kind: "login", command: "gh auth login --hostname github.com" } })] })] }),
    );
    await show();
    expect(screen.getByText("shares the agents' rate limit").className).toContain("text-warning-text");
    expect(screen.getByText("gh auth login --hostname github.com")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Renew/ })).toBeNull();
  });

  it("shows what an account reads as chips after 'Reads', each with an ✕ that removes it (AC8)", async () => {
    fake.api.settings.mockResolvedValue(settingsView({ accounts: [accountSetting({ assignments: [{ scope: "github.com", what: "github.com" }, { scope: "github.com/org", what: "org" }] })] }));
    await show();
    const chips = screen.getByRole("list", { name: "Assigned to GitHub · yuser" });
    expect(chips.previousElementSibling!.textContent).toBe("Reads");
    expect(within(chips).getAllByRole("listitem").map((chip) => chip.textContent)).toEqual(["github.com", "org"]);
    expect(drawnIcons(chips)).toEqual(["X", "X"]);
    fireEvent.click(within(chips).getByRole("button", { name: "Remove org from GitHub · yuser" }));
    await waitFor(() => expect(fake.api.removeAssignment).toHaveBeenCalledWith({ scope: "github.com/org" }));
  });

  it("lists the poll intervals as a table, each fleet with its forge's logo or name (AC9)", async () => {
    fake.api.settings.mockResolvedValue(
      settingsView({
        fleets: [
          { repo: "acme/web", forge: "github", intervalMs: 120_000, isDefault: false },
          { repo: "git.example.com/group/proj", forge: "gitlab", intervalMs: 120_000, isDefault: true },
        ],
      }),
    );
    await show();
    const table = screen.getByRole("table", { name: "Poll interval" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getByRole("rowheader").textContent)).toEqual(["acme/web", "GitLabgit.example.com/group/proj"]);
    expect(drawnIcons(rows[0]!)).toEqual(["GithubLogo"]);
    expect(within(rows[0]!).getByText("seconds")).toBeTruthy();
    expect(within(rows[1]!).getByText("seconds (default)")).toBeTruthy();
    expect(within(rows[1]!).getByRole("button", { name: /to the default/ })).toHaveProperty("disabled", true);
    fireEvent.change(within(rows[0]!).getByRole("textbox"), { target: { value: "abc" } });
    expect(within(rows[0]!).getByRole("alert").textContent).toBe("Enter a whole number of seconds.");
  });

  it("draws only icons bb resolves (AC11)", async () => {
    fake.api.settings.mockResolvedValue(
      settingsView({
        accounts: [
          accountSetting({ loginProblem: "gone", canWrite: true, assignments: [{ scope: "s", what: "org" }], credentials: [credentialSetting({ expiresInDays: 2 }), credentialSetting({ id: "c2", refused: true })] }),
        ],
        fleets: [{ repo: "acme/web", forge: "gitlab", intervalMs: 60_000, isDefault: true }],
      }),
    );
    await show();
    const seen = new Set(drawnIcons(document.body));
    for (const name of drawnIcons(await menuOf("GitHub · yuser"))) seen.add(name);
    expect(seen.size).toBeGreaterThan(6);
    expectIconsResolve(seen);
  });
});


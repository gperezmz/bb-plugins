// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fake, resetFakeApi } from "@/testing/api";
import { accountSetting, credentialSetting, settingsView } from "@/testing/fixtures";
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
const stored = settingsView({ accounts: [yuser, buser], fleets: [{ repo: "acme/web", intervalMs: 120_000, isDefault: false }] });

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

describe("the accounts", () => {
  it("lists each account with its service, host, defaults, and its credentials with what they reach, their kind, expiry and fleets", async () => {
    await show();
    const first = account("GitHub · yuser");
    expect(within(first).getByText("github.com")).toBeTruthy();
    expect(within(first).getByText("default for github.com")).toBeTruthy();
    const credential = within(within(first).getByRole("list", { name: "Credentials of GitHub · yuser" })).getByRole("listitem");
    expect(within(credential).getByText("acme")).toBeTruthy();
    expect(within(credential).getByText("fine-grained token")).toBeTruthy();
    expect(within(credential).getByText("expires 18 Oct")).toBeTruthy();
    expect(within(credential).getByText("read by acme/api")).toBeTruthy();
    expect(within(account("GitHub · buser")).queryByText(/default for/)).toBeNull();
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
    fireEvent.click(within(account("GitHub · yuser")).getByRole("button", { name: "Add token for another owner to GitHub · yuser" }));
    expect(currentConnect()?.request).toEqual({ target: { service: "github", place: "github.com" }, account: "acc_yuser" });
  });

  it("offers Add token for another owner only where the account holds owner tokens", async () => {
    fake.api.settings.mockResolvedValue(settingsView({ accounts: [accountSetting({ addsOwners: false, via: "gh" })] }));
    await show();
    expect(screen.queryByRole("button", { name: /another owner/ })).toBeNull();
  });
});

describe("Renew", () => {
  const expiring = (over = {}) => settingsView({ accounts: [accountSetting({ credentials: [credentialSetting({ expiresInDays: 6, expiresAt: "2026-10-18T12:00:00Z", ...over })] })] });

  it("warns of a token expiring soon and opens the pre-filled page's popup for its owner, replacing it", async () => {
    fake.api.settings.mockResolvedValue(expiring());
    await show();
    expect(screen.getByText("token expires in 6 days")).toBeTruthy();
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
    fireEvent.click(within(account("GitHub · yuser")).getByRole("button", { name: "Remove GitHub · yuser" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm removing GitHub · yuser" }));
    await waitFor(() => expect(fake.api.removeAccount).toHaveBeenCalledWith({ accountId: "acc_yuser" }));
  });

  it("shows the refusal naming the fleets that read as the account", async () => {
    fake.api.removeAccount.mockResolvedValue({ ok: false, reason: "GitHub · buser is read by zorg/z" });
    await show();
    fireEvent.click(within(account("GitHub · buser")).getByRole("button", { name: "Remove GitHub · buser" }));
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

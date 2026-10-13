// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fake, resetFakeApi } from "@/testing/api";
import { accountOption, connectView, half, tokenPage } from "@/testing/fixtures";
import { drawnIcons, drawnLogos, expectIconsResolve } from "@/testing/icons";
import { sdk } from "@/testing/sdk";
import { ConnectOverlay } from "./ConnectOverlay";
import { closeConnect, onConnectSaved, openConnect, type ConnectRequest } from "./requests";

vi.mock("@get-bb/plugin-sdk/app", async () => (await import("@/testing/sdk")).sdkModule());
vi.mock("@/shared/client", async (original) => (await import("@/testing/api")).withFakeClient(await original()));

beforeEach(() => {
  sdk.reset();
  resetFakeApi();
});
afterEach(() => {
  cleanup();
  closeConnect();
});

const forge: ConnectRequest = { target: { fleet: "github.com/acme/web", role: "forge" } };

async function open(request: ConnectRequest) {
  render(<ConnectOverlay />);
  act(() => openConnect(request));
  return screen.findByRole("dialog");
}

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const field = (name: string | RegExp) => screen.getByLabelText(name) as HTMLInputElement;
const savedResult = (over = {}) =>
  ({ outcome: "saved", account: { id: "acc_yuser", label: "GitHub · yuser" }, login: "yuser", expiresAt: "2027-01-10T00:00:00Z", canWrite: false, notReadable: [], half: half(), revoke: null, ...over }) as const;

describe("step 1: which account", () => {
  it("lists the accounts, the default first and marked, and a new login", async () => {
    fake.api.connectView.mockResolvedValue({
      ok: true,
      connect: connectView({ accounts: [accountOption(), accountOption({ id: "acc_buser", label: "GitHub · buser", isDefault: false }), accountOption({ id: "acc_gh", label: "GitHub · cuser", via: "gh", isDefault: false, canWrite: true })] }),
    });
    const dialog = await open(forge);
    const radios = await within(dialog).findAllByRole("radio");
    expect(radios.map((radio) => radio.closest("label")?.textContent)).toEqual([
      expect.stringContaining("GitHub · yuser"),
      "GitHub · buser",
      expect.stringContaining("GitHub · cuser"),
      expect.stringContaining("a new login"),
    ]);
    expect(radios[0]!.closest("label")?.textContent).toContain("default");
    expect(radios[2]!.closest("label")?.textContent).toContain("can write");
    expect(fake.api.connectView).toHaveBeenCalledWith({ fleet: "github.com/acme/web", role: "forge" });
  });

  it("offers only a new login when there is no account at all", async () => {
    fake.api.connectView.mockResolvedValue({ ok: true, connect: connectView({ accounts: [] }) });
    const dialog = await open(forge);
    expect(await within(dialog).findAllByRole("radio")).toHaveLength(1);
    expect(screen.getByRole("radio", { name: /a new login/ })).toHaveProperty("checked", true);
  });

  it("asks GitHub or GitLab first where the host names no service", async () => {
    fake.api.connectView.mockResolvedValue({ ok: true, connect: connectView({ service: null, place: "git.example.com", accounts: [] }) });
    await open(forge);
    fireEvent.click(await screen.findByRole("radio", { name: "GitLab" }));
    expect(await screen.findByRole("radio", { name: /a new login/ })).toBeTruthy();
    click("Continue");
    await screen.findByRole("button", { name: "Verify and save" });
    expect(fake.api.tokenPage).toHaveBeenCalledWith({ fleet: "github.com/acme/web", role: "forge", account: { service: "gitlab", place: "git.example.com" } });
  });

  it("goes straight to verifying for an account that already reaches the fleet, sending no token", async () => {
    fake.api.connectView.mockResolvedValue({ ok: true, connect: connectView({ accounts: [accountOption({ id: "acc_buser", label: "GitHub · buser", reaches: true })] }) });
    fake.api.connect.mockResolvedValue(savedResult({ account: { id: "acc_buser", label: "GitHub · buser" }, login: "buser" }));
    await open(forge);
    click("Continue");
    await screen.findByText("Saved: GitHub · buser");
    expect(fake.api.connect).toHaveBeenCalledWith({ fleet: "github.com/acme/web", role: "forge", account: { id: "acc_buser" }, secret: { kind: "stored" } });
    expect(fake.api.tokenPage).not.toHaveBeenCalled();
  });

  it("offers the token step for the same account when its stored credential is refused", async () => {
    fake.api.connectView.mockResolvedValue({ ok: true, connect: connectView({ accounts: [accountOption({ id: "acc_buser", label: "GitHub · buser", reaches: true })] }) });
    fake.api.connect.mockResolvedValue({ outcome: "refused", text: "GitHub rejected the token. Nothing was stored." });
    fake.api.tokenPage.mockResolvedValue({ ok: true, page: tokenPage() });
    await open(forge);
    click("Continue");
    await screen.findByText("GitHub rejected the token. Nothing was stored.");
    click("Use another credential");
    expect(await screen.findByLabelText("Token")).toBeTruthy();
    expect(fake.api.tokenPage).toHaveBeenCalledWith({ fleet: "github.com/acme/web", role: "forge", account: { id: "acc_buser" } });
  });

  it("shows a refusal to list the accounts", async () => {
    fake.api.connectView.mockResolvedValue({ ok: false, reason: "no such fleet" });
    await open(forge);
    expect((await screen.findByRole("alert")).textContent).toBe("no such fleet");
  });

  it("says a Jira site off atlassian.net is not Jira Cloud and adds no account", async () => {
    fake.api.connectView.mockResolvedValue({ ok: true, connect: connectView({ service: "jira", place: "jira.example.com", accounts: [], problem: "jira.example.com is not a Jira Cloud site" }) });
    await open({ target: { fleet: "gitlab.example.com/platform/infra", role: "tracker" } });
    expect((await screen.findByRole("alert")).textContent).toBe("jira.example.com is not a Jira Cloud site");
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
  });
});

describe("step 2: the credential", () => {
  beforeEach(() => {
    fake.api.connectView.mockResolvedValue({ ok: true, connect: connectView({ accounts: [accountOption({ id: "acc_buser", label: "GitHub · buser", isDefault: false })], current: "acc_buser" }) });
  });

  async function toStepTwo() {
    await open(forge);
    await screen.findByRole("radio", { name: "GitHub · buser" });
    click("Continue");
    await screen.findByRole("button", { name: "Verify and save" });
  }

  it("opens the pre-filled page in the browser and lists the grants, the repositories, the login and where the token goes", async () => {
    fake.api.tokenPage.mockResolvedValue({ ok: true, page: tokenPage({ signInAs: "buser", repositories: ["acme/web", "acme/api"], note: "GitHub cannot issue a fine-grained token for zorg." }) });
    await toStepTwo();
    click("Create token");
    expect(sdk.navigate.openUrl).toHaveBeenCalledWith("https://github.com/settings/personal-access-tokens/new?target_name=acme&expires_in=90");
    expect(within(screen.getByRole("list", { name: "Grants" })).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Issues: read", "Pull requests: read", "Metadata: read"]);
    expect(within(screen.getByRole("list", { name: "Repositories to tick" })).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["acme/web", "acme/api"]);
    expect(screen.getByText(/signed in as buser/)).toBeTruthy();
    expect(screen.getByText("GitHub cannot issue a fine-grained token for zorg.")).toBeTruthy();
    expect(screen.getByText("The token will be sent to api.github.com, and nowhere else.")).toBeTruthy();
    expect(fake.api.tokenPage).toHaveBeenCalledWith({ fleet: "github.com/acme/web", role: "forge", account: { id: "acc_buser" } });
  });

  it("tells a GitLab operator to choose the expiry on the page", async () => {
    fake.api.connectView.mockResolvedValue({ ok: true, connect: connectView({ service: "gitlab", place: "gitlab.example.com", accounts: [] }) });
    fake.api.tokenPage.mockResolvedValue({ ok: true, page: tokenPage({ sentTo: "gitlab.example.com", grants: ["read_api"], repositories: [], chooseExpiry: true, signInAs: null }) });
    await open(forge);
    click(await screen.findByRole("button", { name: "Continue" }).then(() => "Continue"));
    await screen.findByText(/choose it on the page/);
    expect(screen.getByText(/signed in as the login you are adding/)).toBeTruthy();
  });

  it("offers no Create token where the page is pasted, as for a Linear key", async () => {
    fake.api.connectView.mockResolvedValue({ ok: true, connect: connectView({ service: "linear", place: "linear.app", accounts: [] }) });
    fake.api.tokenPage.mockResolvedValue({ ok: true, page: tokenPage({ url: null, grants: [], repositories: [], sentTo: "api.linear.app", signInAs: null }) });
    await open({ target: { fleet: "github.com/acme/web", role: "tracker" } });
    click(await screen.findByRole("button", { name: "Continue" }).then(() => "Continue"));
    await screen.findByLabelText("API key");
    expect(screen.queryByRole("button", { name: "Create token" })).toBeNull();
    expect(screen.getByText("The key will be sent to api.linear.app, and nowhere else.")).toBeTruthy();
  });

  it("sends the token on Verify and save, and clears the field", async () => {
    fake.api.connect.mockResolvedValue({ outcome: "invalid", text: "The service rejected the token." });
    await toStepTwo();
    const input = field("Token");
    expect(input.type).toBe("password");
    fireEvent.change(input, { target: { value: "  fake-secret-token  " } });
    click("Verify and save");
    await screen.findByText("The service rejected the token.");
    expect(fake.api.connect).toHaveBeenCalledWith({ fleet: "github.com/acme/web", role: "forge", account: { id: "acc_buser" }, secret: { kind: "token", token: "fake-secret-token" } });
    expect(document.body.innerHTML).not.toContain("fake-secret-token");
  });

  it("will not send without a token", async () => {
    await toStepTwo();
    expect((screen.getByRole("button", { name: "Verify and save" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("uses the gh login of the account, from the logins gh holds", async () => {
    fake.api.cliLogins.mockResolvedValue({ logins: ["yuser", "buser"] });
    fake.api.connect.mockResolvedValue(savedResult());
    await toStepTwo();
    expect(fake.api.cliLogins).toHaveBeenCalledWith({ tool: "gh", host: "github.com" });
    fireEvent.click(screen.getByRole("radio", { name: /Use your gh login/ }));
    expect((screen.getByLabelText("gh login") as HTMLSelectElement).value).toBe("buser");
    click("Verify and save");
    await screen.findByText(/Saved/);
    expect(fake.api.connect).toHaveBeenCalledWith(expect.objectContaining({ secret: { kind: "login", tool: "gh", login: "buser" } }));
  });

  it("asks a Jira site's email and API token", async () => {
    fake.api.connectView.mockResolvedValue({ ok: true, connect: connectView({ service: "jira", place: "acme.atlassian.net", accounts: [] }) });
    fake.api.tokenPage.mockResolvedValue({ ok: true, page: tokenPage({ url: null, grants: [], repositories: [], sentTo: "acme.atlassian.net", signInAs: null }) });
    fake.api.connect.mockResolvedValue({ outcome: "invalid", text: "rejected" });
    await open({ target: { fleet: "gitlab.example.com/platform/infra", role: "tracker" } });
    click(await screen.findByRole("button", { name: "Continue" }).then(() => "Continue"));
    fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "ops@acme.com" } });
    fireEvent.change(field("API token"), { target: { value: "jira-secret" } });
    click("Verify and save");
    await screen.findByText("rejected");
    expect(fake.api.connect).toHaveBeenCalledWith(expect.objectContaining({ secret: { kind: "jira", email: "ops@acme.com", token: "jira-secret" } }));
  });
});

describe("step 3: what was found", () => {
  async function verify() {
    fake.api.connectView.mockResolvedValue({ ok: true, connect: connectView({ accounts: [] }) });
    await open(forge);
    click(await screen.findByRole("button", { name: "Continue" }).then(() => "Continue"));
    await screen.findByRole("button", { name: "Verify and save" });
    fireEvent.change(field("Token"), { target: { value: "fake-secret-token" } });
    click("Verify and save");
  }

  it("holds a new login's token for the operator to confirm, then sends the same call with confirm", async () => {
    fake.api.connect.mockResolvedValueOnce({ outcome: "confirm", login: "yuser", label: "GitHub · yuser", text: "This token belongs to yuser. Add as GitHub · yuser?" });
    await verify();
    await screen.findByText("This token belongs to yuser. Add as GitHub · yuser?");
    expect(document.body.innerHTML).not.toContain("fake-secret-token");
    fake.api.connect.mockResolvedValueOnce(savedResult());
    click("Add as GitHub · yuser");
    await screen.findByText("Saved: GitHub · yuser");
    expect(fake.api.connect).toHaveBeenLastCalledWith({
      fleet: "github.com/acme/web",
      role: "forge",
      account: { service: "github", place: "github.com" },
      secret: { kind: "token", token: "fake-secret-token" },
      confirm: true,
    });
  });

  it("sends nothing more once the operator closes the confirmation", async () => {
    fake.api.connect.mockResolvedValueOnce({ outcome: "confirm", login: "yuser", label: "GitHub · yuser", text: "Add?" });
    await verify();
    await screen.findByText("Add?");
    click("Close");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(fake.api.connect).toHaveBeenCalledTimes(1);
  });

  it("shows the wrong login with the command that signs in as the right one, and offers Check again and another credential", async () => {
    fake.api.connect.mockResolvedValue({ outcome: "wrong-login", text: "gh is signed in as yuser, not buser", command: "gh auth login --hostname github.com" });
    await verify();
    expect((await screen.findByRole("alert")).textContent).toContain("gh is signed in as yuser, not buser");
    expect(screen.getByText("gh auth login --hostname github.com").tagName).toBe("CODE");
    expect(screen.getByRole("button", { name: "Check again" })).toBeTruthy();
    click("Use another credential");
    expect(await screen.findByRole("button", { name: "Verify and save" })).toBeTruthy();
    expect(field("Token").value).toBe("");
  });

  it("shows a refusal and checks again, which reads the fleet at once", async () => {
    fake.api.connect.mockResolvedValue({ outcome: "refused", text: "The service refused this token." });
    fake.api.checkAgain.mockResolvedValue({ ok: true, half: half({ needs: "needs a token that GitHub accepts" }), notReadable: [] });
    await verify();
    await screen.findByText("The service refused this token.");
    click("Check again");
    await screen.findByText("acme/web still needs an account: needs a token that GitHub accepts");
    expect(fake.api.checkAgain).toHaveBeenCalledWith({ fleet: "github.com/acme/web", role: "forge" });
  });

  it("reports an unreachable service with a way to try again", async () => {
    fake.api.connect.mockResolvedValue({ outcome: "unreachable", text: "github.com did not answer." });
    await verify();
    await screen.findByText("github.com did not answer.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("shows a saved credential: whose it is, its expiry, can write, and the half as read now", async () => {
    fake.api.connect.mockResolvedValue(savedResult({ canWrite: true, expiresAt: null }));
    await verify();
    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("Saved: GitHub · yuser");
    expect(status.textContent).toContain("yuser, no expiry reported");
    expect(status.textContent).toContain("can write");
    expect(screen.getByText("acme/web is read as GitHub · yuser.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Done" })).toBeTruthy();
  });

  it("names each repository a saved fine-grained token cannot read, with both remedies, and checks again", async () => {
    fake.api.connect.mockResolvedValue(
      savedResult({
        half: half({ needs: "GitHub · yuser for acme cannot read acme/web: the repository is not ticked on the token, or an organisation owner has not yet approved the token. Add the repository to the token on GitHub, or create a new token." }),
        notReadable: [
          {
            fleet: "github.com/acme/web",
            text: "acme/web is not readable as GitHub · yuser for acme: the repository is not ticked on the token, or an organisation owner has not yet approved the token. Add the repository to the token on GitHub, or create a new token.",
            fineGrained: true,
          },
        ],
      }),
    );
    fake.api.checkAgain.mockResolvedValue({ ok: true, half: half(), notReadable: [] });
    await verify();
    const list = await screen.findByRole("list", { name: "Not readable" });
    expect(within(list).getByText("github.com/acme/web")).toBeTruthy();
    // The server's text says the causes and the remedies, once.
    expect(within(list).getAllByText(/not ticked on the token, or an organisation owner/)).toHaveLength(1);
    expect(screen.getByRole("dialog").textContent!.match(/Add the repository to the token on GitHub/g)).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Choose another account" })).toBeNull();
    click("Check again");
    await waitFor(() => expect(screen.queryByRole("list", { name: "Not readable" })).toBeNull());
    expect(screen.getByText("acme/web is read as GitHub · yuser.")).toBeTruthy();
  });

  it("offers another account for a repository another kind of credential cannot see", async () => {
    fake.api.connect.mockResolvedValue(savedResult({ notReadable: [{ fleet: "acme/web", text: "yuser cannot see acme/web", fineGrained: false }] }));
    await verify();
    fireEvent.click(await screen.findByRole("button", { name: "Choose another account" }));
    expect(await screen.findByRole("radio", { name: /a new login/ })).toBeTruthy();
  });

  it("points to the service's token page after a Renew", async () => {
    fake.api.connect.mockResolvedValue(savedResult({ revoke: { text: "The old token still works at GitHub until it expires or you revoke it.", url: "https://github.com/settings/personal-access-tokens" } }));
    await verify();
    expect(await screen.findByText(/The old token still works at GitHub/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open the token page/ }).getAttribute("href")).toBe("https://github.com/settings/personal-access-tokens");
  });

  it("announces a saved credential so a list need not wait for the server's signal", async () => {
    const heard = vi.fn();
    const stop = onConnectSaved(heard);
    fake.api.connect.mockResolvedValue(savedResult());
    await verify();
    await screen.findByText(/Saved/);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(heard).toHaveBeenCalledWith(null);
    stop();
  });

  it("shows a failed call in words, with no token in them", async () => {
    fake.api.connect.mockRejectedValue(new Error("the server is not running"));
    await verify();
    expect((await screen.findByRole("alert")).textContent).toBe("the server is not running");
    expect(document.body.innerHTML).not.toContain("fake-secret-token");
    expect(field("Token").value).toBe("");
  });
});

describe("Add account", () => {
  it("asks the service, the host and the owner, then goes to the token step for a new login", async () => {
    fake.api.connectView.mockResolvedValue({ ok: true, connect: connectView({ fleet: null, role: null, what: null, scope: null, owner: "zorg", accounts: [] }) });
    await open({ target: {} });
    fireEvent.click(screen.getByRole("radio", { name: "GitHub" }));
    expect(field("Host").value).toBe("github.com");
    expect((screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(field("Owner"), { target: { value: "zorg" } });
    click("Continue");
    await screen.findByRole("button", { name: "Verify and save" });
    expect(fake.api.connectView).toHaveBeenCalledWith({ service: "github", place: "github.com", owner: "zorg" });
    expect(fake.api.tokenPage).toHaveBeenCalledWith({ service: "github", place: "github.com", owner: "zorg", account: { service: "github", place: "github.com" } });
  });

  it("asks a Jira site and shows why a site off atlassian.net takes no account", async () => {
    fake.api.connectView.mockResolvedValue({ ok: true, connect: connectView({ service: "jira", place: "jira.example.com", accounts: [], problem: "jira.example.com is not a Jira Cloud site" }) });
    await open({ target: {} });
    fireEvent.click(screen.getByRole("radio", { name: "Jira" }));
    fireEvent.change(field("Jira site"), { target: { value: "jira.example.com" } });
    click("Continue");
    expect((await screen.findByRole("alert")).textContent).toBe("jira.example.com is not a Jira Cloud site");
    expect(fake.api.tokenPage).not.toHaveBeenCalled();
  });

  it("asks only the owner for Add token for another owner, and lands on the token step for that account", async () => {
    fake.api.connectView.mockResolvedValue({ ok: true, connect: connectView({ fleet: null, role: null, accounts: [accountOption()] }) });
    await open({ target: { service: "github", place: "github.com" }, account: "acc_yuser" });
    expect(screen.queryByRole("radio")).toBeNull();
    fireEvent.change(field("Owner"), { target: { value: "zorg" } });
    click("Continue");
    await screen.findByRole("button", { name: "Verify and save" });
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    expect(fake.api.tokenPage).toHaveBeenCalledWith({ service: "github", place: "github.com", owner: "zorg", account: { id: "acc_yuser" } });
  });
});

describe("Renew", () => {
  it("opens at the token step for the account and owner, and sends the credential it replaces", async () => {
    fake.api.connectView.mockResolvedValue({ ok: true, connect: connectView({ fleet: null, role: null, accounts: [accountOption()] }) });
    fake.api.connect.mockResolvedValue(savedResult());
    await open({ target: { service: "github", place: "github.com", owner: "acme" }, account: "acc_yuser", replaces: "cred_acme" });
    await screen.findByRole("button", { name: "Verify and save" });
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    fireEvent.change(field("Token"), { target: { value: "new-secret" } });
    click("Verify and save");
    await screen.findByText(/Saved/);
    expect(fake.api.connect).toHaveBeenCalledWith({
      service: "github",
      place: "github.com",
      owner: "acme",
      account: { id: "acc_yuser" },
      secret: { kind: "token", token: "new-secret" },
      replaces: "cred_acme",
    });
  });

  it("sends the fleet and role of the card it was opened from, with the account and the credential it replaces", async () => {
    fake.api.connectView.mockResolvedValue({ ok: true, connect: connectView({ accounts: [accountOption()] }) });
    fake.api.connect.mockResolvedValue(savedResult());
    await open({ target: { fleet: "github.com/acme/web", role: "forge" }, account: "acc_yuser", replaces: "cred_acme" });
    await screen.findByRole("button", { name: "Verify and save" });
    // A Renew keeps its account: there is no way back to choosing another, which would drop the token it replaces.
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    fireEvent.change(field("Token"), { target: { value: "new-secret" } });
    click("Verify and save");
    await screen.findByText(/Saved/);
    expect(fake.api.connect).toHaveBeenCalledWith({
      fleet: "github.com/acme/web",
      role: "forge",
      account: { id: "acc_yuser" },
      secret: { kind: "token", token: "new-secret" },
      replaces: "cred_acme",
    });
  });
});

describe("the popup", () => {
  it("opens over the current view and closes on Escape", async () => {
    await open(forge);
    await screen.findByRole("radio", { name: /a new login/ });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("draws nothing while no popup was asked for", () => {
    const view = render(<ConnectOverlay />);
    expect(view.baseElement.textContent).toBe("");
  });
});

/** The step marker's steps, each as `<name>:<mark>`. */
const marks = () => within(screen.getByRole("list", { name: "Steps" })).getAllByRole("listitem").filter((item) => item.hasAttribute("data-mark")).map((item) => `${item.textContent!.replace(/^\d/, "")}:${item.getAttribute("data-mark")}`);
const iconsIn = (element: Element) => drawnIcons(element);

describe("the popup's look", () => {
  it("leads the title with the service's logo and marks how far the flow has got (AC1)", async () => {
    fake.api.connectView.mockResolvedValue({ ok: true, connect: connectView({ accounts: [accountOption()] }) });
    fake.api.connect.mockResolvedValue(savedResult());
    await open(forge);
    await screen.findByRole("radio", { name: /GitHub · yuser/ });
    const title = screen.getByRole("heading", { name: /Connect acme\/web/ });
    expect(iconsIn(title)).toEqual(["GithubLogo"]);
    expect(within(title).getByRole("img", { name: "GitHub" })).toBeTruthy();
    expect(marks()).toEqual(["Account:current", "Token:later", "Done:later"]);
    expect(screen.getByRole("list", { name: "Steps" }).querySelector("[aria-current=step]")!.textContent).toContain("Account");
    click("Continue");
    await screen.findByRole("button", { name: "Verify and save" });
    expect(marks()).toEqual(["Account:done", "Token:current", "Done:later"]);
    fireEvent.change(field("Token"), { target: { value: "fake-secret-token" } });
    click("Verify and save");
    await screen.findByText("Saved: GitHub · yuser");
    expect(marks()).toEqual(["Account:done", "Token:done", "Done:done"]);
    expect(iconsIn(screen.getByRole("list", { name: "Steps" }))).toEqual(["Check", "Check", "Check"]);
  });

  it("keeps Token current and Done grey for any outcome but saved (AC1)", async () => {
    for (const outcome of [
      { outcome: "refused", text: "Refused." },
      { outcome: "confirm", login: "yuser", label: "GitHub · yuser", text: "Belongs to yuser." },
      { outcome: "unreachable", text: "No answer." },
    ] as const) {
      fake.api.connectView.mockResolvedValue({ ok: true, connect: connectView({ accounts: [] }) });
      fake.api.connect.mockResolvedValue(outcome);
      await open(forge);
      click(await screen.findByRole("button", { name: "Continue" }).then(() => "Continue"));
      await screen.findByRole("button", { name: "Verify and save" });
      fireEvent.change(field("Token"), { target: { value: "fake-secret-token" } });
      click("Verify and save");
      await screen.findByText(outcome.text);
      expect(marks()).toEqual(["Account:done", "Token:current", "Done:later"]);
      cleanup();
      closeConnect();
    }
  });

  it("offers the four services as logo tiles on Add account, the chosen one marked (AC2)", async () => {
    await open({ target: {} });
    const tiles = within(screen.getByRole("group", { name: "Service" })).getAllByRole("radio");
    expect(tiles.map((tile) => tile.closest("label")!.textContent)).toEqual(["GitHub", "GitLab", "Linear", "Jira"]);
    // GitHub's logo is bb's; the other three are their brands' own.
    expect(iconsIn(screen.getByRole("group", { name: "Service" }))).toEqual(["GithubLogo"]);
    expect(drawnLogos(screen.getByRole("group", { name: "Service" }))).toEqual(["gitlab", "linear", "jira"]);
    fireEvent.click(screen.getByRole("radio", { name: "GitLab" }));
    expect(screen.getByRole("radio", { name: "GitLab" })).toHaveProperty("checked", true);
    expect(iconsIn(screen.getByRole("radio", { name: "GitLab" }).closest("label")!)).toEqual(["Check"]);
    expect(field("Host").value).toBe("gitlab.com");
  });

  it("offers GitHub and GitLab as tiles where the host names no service, keeping the choice marked (AC2)", async () => {
    fake.api.connectView.mockResolvedValue({ ok: true, connect: connectView({ service: null, place: "git.example.com", accounts: [] }) });
    await open(forge);
    const group = await screen.findByRole("group", { name: "git.example.com is which service?" });
    expect(within(group).getAllByRole("radio").map((tile) => tile.closest("label")!.textContent)).toEqual(["GitHub", "GitLab"]);
    fireEvent.click(screen.getByRole("radio", { name: "GitLab" }));
    expect(screen.getByRole("radio", { name: "GitLab" })).toHaveProperty("checked", true);
    expect((await screen.findByRole("radio", { name: /a new login/ })).closest("label")!.textContent).toContain("GitLab on git.example.com");
  });

  it("draws each account as a card with its logo and pills, its login problem on a red line, and a new login last (AC3)", async () => {
    fake.api.connectView.mockResolvedValue({
      ok: true,
      connect: connectView({
        accounts: [
          accountOption({ reaches: true }),
          accountOption({ id: "acc_gh", label: "GitHub · cuser", via: "gh", isDefault: false, canWrite: true, loginProblem: "gh is signed in as yuser, not cuser" }),
        ],
      }),
    });
    await open(forge);
    const first = (await screen.findByRole("radio", { name: /GitHub · yuser/ })).closest("label")!;
    expect(first.textContent).toBe("GitHub · yuserdefaultalready reads this");
    expect(iconsIn(first)).toEqual(["GithubLogo", "Check"]);
    expect(within(first).getByText("already reads this").className).toContain("text-success");
    const second = screen.getByRole("radio", { name: /GitHub · cuser/ }).closest("label")!;
    expect(within(second).getByText("can write").className).toContain("text-warning-text");
    const problem = within(second).getByText("gh is signed in as yuser, not cuser");
    expect(problem.className).toContain("text-destructive-text");
    expect(iconsIn(problem)).toEqual(["CircleX"]);
    const last = screen.getAllByRole("radio").at(-1)!.closest("label")!;
    expect(last.textContent).toBe("a new loginGitHub on github.com");
    expect(iconsIn(last)).toEqual(["Plus"]);
    expect(screen.getByRole("group", { name: "Which account reads acme?" })).toBeTruthy();
  });

  it("draws a GitLab flow's logo in the title, on each account card and on Create token, not the word GitLab (AC1)", async () => {
    fake.api.connectView.mockResolvedValue({ ok: true, connect: connectView({ service: "gitlab", place: "gitlab.example.com", accounts: [accountOption({ id: "acc_gl", label: "GitLab · yuser" })] }) });
    fake.api.tokenPage.mockResolvedValue({ ok: true, page: tokenPage({ sentTo: "gitlab.example.com", grants: ["read_api"], repositories: [], chooseExpiry: true, signInAs: null }) });
    await open(forge);
    const card = (await screen.findByRole("radio", { name: /GitLab · yuser/ })).closest("label")!;
    const title = screen.getByRole("heading", { name: /Connect acme\/web/ });
    expect(drawnLogos(title)).toEqual(["gitlab"]);
    expect(within(title).getByRole("img", { name: "GitLab" })).toBeTruthy();
    expect(drawnLogos(card)).toEqual(["gitlab"]);
    expect(within(card).queryByRole("img")).toBeNull();
    click("Continue");
    const create = await screen.findByRole("region", { name: "Create a token" });
    expect(drawnLogos(within(create).getByRole("button", { name: "Create token" }))).toEqual(["gitlab"]);
  });

  it("splits the token step into creating the token and giving it to the plugin, with Back and a shielded Verify and save (AC4)", async () => {
    fake.api.connectView.mockResolvedValue({ ok: true, connect: connectView({ accounts: [accountOption({ isDefault: false })] }) });
    fake.api.tokenPage.mockResolvedValue({ ok: true, page: tokenPage({ signInAs: "yuser", repositories: ["acme/web"], note: "A note from the server." }) });
    fake.api.cliLogins.mockResolvedValue({ logins: [] });
    await open(forge);
    await screen.findByRole("radio", { name: /GitHub · yuser/ });
    click("Continue");
    const create = await screen.findByRole("region", { name: "Create a token" });
    const give = screen.getByRole("region", { name: "Give it to the plugin" });
    expect(within(create).getByRole("heading").textContent).toBe("1Create a token");
    expect(within(give).getByRole("heading").textContent).toBe("2Give it to the plugin");
    expect(iconsIn(within(create).getByRole("button", { name: "Create token" }))).toEqual(["GithubLogo", "ExternalLink"]);
    expect(within(create).getByText(/signed in as yuser/)).toBeTruthy();
    expect(within(create).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Issues: read", "Pull requests: read", "Metadata: read", "acme/web"]);
    expect(within(create).getByText("A note from the server.").className).toContain("text-warning-text");
    const login = within(give).getByRole("radio", { name: "Use your gh login" });
    expect(login).toHaveProperty("disabled", true);
    expect(within(give).getByRole("radio", { name: "Paste a token" })).toHaveProperty("checked", true);
    expect(within(give).getByText("gh holds no login for this host.")).toBeTruthy();
    expect(iconsIn(within(give).getByText("The token will be sent to api.github.com, and nowhere else."))).toEqual(["Lock"]);
    expect(iconsIn(screen.getByRole("button", { name: "Verify and save" }))).toEqual(["SecurityCheck"]);
    click("Back");
    expect(await screen.findByRole("radio", { name: /GitHub · yuser/ })).toBeTruthy();
    expect(marks()).toEqual(["Account:current", "Token:later", "Done:later"]);
  });

  it("asks a Jira site's email inside the second part, alone and unnumbered where the service has no token page (AC4)", async () => {
    fake.api.connectView.mockResolvedValue({ ok: true, connect: connectView({ service: "jira", place: "acme.atlassian.net", accounts: [] }) });
    fake.api.tokenPage.mockResolvedValue({ ok: true, page: tokenPage({ url: null, grants: [], repositories: [], sentTo: "acme.atlassian.net", signInAs: null }) });
    await open({ target: { fleet: "github.com/acme/web", role: "tracker" } });
    click(await screen.findByRole("button", { name: "Continue" }).then(() => "Continue"));
    const give = await screen.findByRole("region", { name: "Give it to the plugin" });
    expect(screen.queryByRole("region", { name: "Create a token" })).toBeNull();
    expect(within(give).getByRole("heading").textContent).toBe("Give it to the plugin");
    expect(within(give).getByLabelText("Email")).toBeTruthy();
    expect(within(give).queryByRole("radio")).toBeNull();
  });

  it("shows a saved token in a green box, and the half read with a green check (AC5)", async () => {
    fake.api.connectView.mockResolvedValue({ ok: true, connect: connectView({ accounts: [accountOption({ reaches: true })] }) });
    fake.api.connect.mockResolvedValue(savedResult({ canWrite: true }));
    await open(forge);
    await screen.findByRole("radio", { name: /GitHub · yuser/ });
    click("Continue");
    const box = await screen.findByRole("status");
    expect(box.className).toContain("border-success");
    expect(box.className).toContain("bg-success/10");
    expect(iconsIn(box)).toEqual(["CircleCheck"]);
    expect(box.textContent).toBe("Saved: GitHub · yuseryuser, expires 10 Jancan write");
    const read = screen.getByText("acme/web is read as GitHub · yuser.");
    expect(iconsIn(read)).toEqual(["Check"]);
  });

  it("shows each fleet still unreadable in a red box with its sentence, and the half in red (AC5)", async () => {
    fake.api.connectView.mockResolvedValue({ ok: true, connect: connectView({ accounts: [accountOption({ reaches: true })] }) });
    fake.api.connect.mockResolvedValue(savedResult({ half: half({ needs: "no" }), notReadable: [{ fleet: "github.com/acme/web", text: "acme/web is not readable as GitHub · yuser.", fineGrained: false }] }));
    await open(forge);
    await screen.findByRole("radio", { name: /GitHub · yuser/ });
    click("Continue");
    const entry = within(await screen.findByRole("list", { name: "Not readable" })).getByRole("listitem");
    expect(entry.className).toContain("border-destructive");
    expect(iconsIn(entry)).toEqual(["CircleX"]);
    expect(entry.textContent).toBe("github.com/acme/webacme/web is not readable as GitHub · yuser.");
    expect(screen.getByText("acme/web still needs an account that can read it.").className).toContain("text-destructive-text");
    expect(screen.getByRole("button", { name: "Choose another account" })).toBeTruthy();
  });

  it("shows a refusal in red and a confirmation in the plain text colour, the confirming button solid (AC5)", async () => {
    fake.api.connectView.mockResolvedValue({ ok: true, connect: connectView({ accounts: [] }) });
    fake.api.connect.mockResolvedValueOnce({ outcome: "confirm", login: "yuser", label: "GitHub · yuser", text: "Belongs to yuser." });
    await open(forge);
    click(await screen.findByRole("button", { name: "Continue" }).then(() => "Continue"));
    await screen.findByRole("button", { name: "Verify and save" });
    fireEvent.change(field("Token"), { target: { value: "fake-secret-token" } });
    click("Verify and save");
    expect((await screen.findByText("Belongs to yuser.")).className).toBe("");
    expect(screen.getByRole("button", { name: "Add as GitHub · yuser" }).className).toContain("bg-foreground");
    fake.api.connect.mockResolvedValueOnce({ outcome: "invalid", text: "The service rejected the token." });
    click("Add as GitHub · yuser");
    expect((await screen.findByText("The service rejected the token.")).className).toContain("text-destructive-text");
  });

  it("draws only icons bb resolves, on every step (AC11)", async () => {
    const seen = new Set<string>();
    const note = () => drawnIcons(document.body).forEach((name) => seen.add(name));
    fake.api.connectView.mockResolvedValue({ ok: true, connect: connectView({ accounts: [accountOption({ loginProblem: "gone", canWrite: true })] }) });
    fake.api.tokenPage.mockResolvedValue({ ok: true, page: tokenPage() });
    fake.api.connect.mockResolvedValue(savedResult({ notReadable: [{ fleet: "acme/web", text: "no", fineGrained: false }] }));
    await open(forge);
    await screen.findByRole("radio", { name: /GitHub · yuser/ });
    note();
    click("Continue");
    await screen.findByRole("button", { name: "Verify and save" });
    note();
    fireEvent.change(field("Token"), { target: { value: "fake-secret-token" } });
    click("Verify and save");
    await screen.findByText("Saved: GitHub · yuser");
    note();
    cleanup();
    closeConnect();
    await open({ target: {} });
    fireEvent.click(screen.getByRole("radio", { name: "GitHub" }));
    note();
    expect(seen.size).toBeGreaterThan(8);
    expectIconsResolve(seen);
  });
});


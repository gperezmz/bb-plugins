// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fake, resetFakeApi } from "@/testing/api";
import { settingsView } from "@/testing/fixtures";
import { sdk } from "@/testing/sdk";
import { CredentialsSettings } from "./index";

vi.mock("@get-bb/plugin-sdk/app", async () => (await import("@/testing/sdk")).sdkModule());
vi.mock("@/shared/client", async (original) => (await import("@/testing/api")).withFakeClient(await original()));

const FAKE_TOKEN = "fake-token-not-a-secret";

const stored = settingsView({
  credentials: [
    { prefix: "github.com/acme", auth: "token", service: "github", baseUrl: null, hasToken: true, expiresAt: "2026-10-18T12:00:00Z", problem: null },
    { prefix: "gitlab.example.com", auth: "glab", service: null, baseUrl: null, hasToken: false, expiresAt: null, problem: "gitlab.example.com does not name its service" },
  ],
  fleets: [{ repo: "acme/web", intervalMs: 120_000, isDefault: false }],
  problems: ["the tokens setting has a line without a prefix"],
});

beforeEach(() => {
  sdk.reset();
  resetFakeApi();
  fake.api.settings.mockResolvedValue(stored);
});
afterEach(cleanup);

const show = async () => {
  render(<CredentialsSettings />);
  await screen.findByRole("heading", { name: "Credentials" });
};

describe("the credentials", () => {
  it("lists every credential with its prefix, kind and expiry where known, and a note where it cannot be used", async () => {
    await show();
    const first = screen.getByText("github.com/acme").closest("li")!;
    expect(within(first).getByText("pasted token")).toBeTruthy();
    expect(within(first).getByText("token stored")).toBeTruthy();
    expect(within(first).getByText("expires 18 Oct")).toBeTruthy();
    const second = screen.getByText("gitlab.example.com").closest("li")!;
    expect(within(second).getByText("glab login")).toBeTruthy();
    expect(within(second).getByText(/cannot be used: gitlab\.example\.com does not name its service/)).toBeTruthy();
  });

  it("says the generic settings above edit the same list", async () => {
    await show();
    expect(screen.getByText(/edit the same list as this section/)).toBeTruthy();
    expect(screen.getByText("the tokens setting has a line without a prefix")).toBeTruthy();
  });

  it("adds a pasted token through a password field and never shows it again", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await show();
    fireEvent.click(screen.getByRole("button", { name: "Add a credential" }));
    fireEvent.change(screen.getByLabelText("Prefix"), { target: { value: "github.com/other" } });
    const token = screen.getByLabelText("Token") as HTMLInputElement;
    expect(token.type).toBe("password");
    expect((screen.getByRole("button", { name: "Add" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(token, { target: { value: FAKE_TOKEN } });
    fake.api.saveCredential.mockResolvedValue({ ok: true, settings: stored });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(fake.api.saveCredential).toHaveBeenCalledWith({ prefix: "github.com/other", auth: "token", token: FAKE_TOKEN }));
    await waitFor(() => expect(screen.queryByRole("form")).toBeNull());
    expect(document.body.innerHTML).not.toContain(FAKE_TOKEN);
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("adds a gh login without a token field", async () => {
    await show();
    fireEvent.click(screen.getByRole("button", { name: "Add a credential" }));
    fireEvent.change(screen.getByLabelText("Prefix"), { target: { value: "github.com" } });
    fireEvent.change(screen.getByLabelText("Kind"), { target: { value: "gh" } });
    expect(screen.queryByLabelText("Token")).toBeNull();
    fake.api.saveCredential.mockResolvedValue({ ok: true, settings: stored });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(fake.api.saveCredential).toHaveBeenCalledWith({ prefix: "github.com", auth: "gh" }));
  });

  it("edits an entry with the token field blank, which keeps the stored token", async () => {
    await show();
    fireEvent.click(screen.getByRole("button", { name: "Edit github.com/acme" }));
    expect((screen.getByLabelText("Token") as HTMLInputElement).value).toBe("");
    expect(screen.getByText("Leave blank to keep the stored token.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("API URL (optional)"), { target: { value: "https://api.github.com" } });
    fake.api.saveCredential.mockResolvedValue({ ok: true, settings: stored });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fake.api.saveCredential).toHaveBeenCalledWith({ was: "github.com/acme", prefix: "github.com/acme", auth: "token", service: "github", baseUrl: "https://api.github.com" }));
  });

  it("shows the server's refusal and keeps the form", async () => {
    await show();
    fireEvent.click(screen.getByRole("button", { name: "Edit github.com/acme" }));
    fake.api.saveCredential.mockResolvedValue({ ok: false, reason: "baseUrl must be https" });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findByRole("alert")).textContent).toBe("baseUrl must be https");
    expect(screen.getByRole("form", { name: "Edit github.com/acme" })).toBeTruthy();
  });

  it("asks before removing, and removes only on confirmation", async () => {
    await show();
    fireEvent.click(screen.getByRole("button", { name: "Remove github.com/acme" }));
    expect(fake.api.removeCredential).not.toHaveBeenCalled();
    expect(screen.getByText("Remove github.com/acme?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect(fake.api.removeCredential).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Remove github.com/acme" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm removing github.com/acme" }));
    await waitFor(() => expect(fake.api.removeCredential).toHaveBeenCalledWith({ prefix: "github.com/acme" }));
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

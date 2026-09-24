import { describe, expect, it } from "vitest";
import { hostOf, isAllowedSourceUrl, isInternalHost } from "./netguard.js";
import { assertPublicUrl } from "../server/netguard.js";

describe("internal hosts, however they are spelled", () => {
  it.each([
    "localhost", "localhost.", "LOCALHOST", "foo.localhost", "printer.local", "db.internal",
    "127.0.0.1", "127.1", "2130706433", "0x7f.1", "017700000001", "0.0.0.0",
    "10.0.0.5", "172.20.1.1", "192.168.0.1", "169.254.169.254", "100.64.0.1", "198.18.0.1", "224.0.0.1",
    "::1", "[::1]", "::", "::ffff:127.0.0.1", "[::ffff:7f00:1]", "::ffff:10.0.0.1", "64:ff9b::a00:1",
    "2002:7f00:1::", "::ffff:0:127.0.0.1", "2002:a00:1::1",
    "fe80::1", "fe90::1", "fec0::1", "febf::1", "fc00::1", "fd12:3456::1", "ff02::1",
  ])("%s is internal", (host) => {
    expect(isInternalHost(host)).toBe(true);
  });

  it.each(["github.com", "example.com", "8.8.8.8", "2001:4860:4860::8888", "::ffff:8.8.8.8"])("%s is public", (host) => {
    expect(isInternalHost(host)).toBe(false);
  });

  it("reads hosts out of every URL form", () => {
    expect(hostOf("ssh://git@127.1:47811/x.git")).toBe("127.0.0.1");
    expect(hostOf("git@2130706433:x/y.git")).toBe("127.0.0.1");
    expect(hostOf("https://[::ffff:127.0.0.1]:47811/o.yaml")).toBe("::ffff:7f00:1");
    expect(hostOf("https://localhost.:47811/o.yaml")).toBe("localhost");
    expect(hostOf("file:///srv/repo.git")).toBeNull();
  });

  it.each([
    "https://localhost.:47811/o.yaml",
    "https://[::ffff:127.0.0.1]:47811/o.yaml",
    "ssh://git@127.1:47811/x.git#main:o.yaml",
    "ssh://git@2130706433/x.git#main:o.yaml",
    "git@127.1:x/y.git#main:o.yaml",
    "ssh://git@[::ffff:10.0.0.1]/x.git#main:o.yaml",
    "https://[fe90::1]/o.yaml",
    "https://127.0.0.1:47811\\@x.invalid/o.yaml",
    "https://x.invalid/o .yaml",
  ])("refuses the source URL %s", (url) => {
    expect(isAllowedSourceUrl(url.split("#")[0]!)).toBe(false);
  });
});

describe("DNS answers", () => {
  const resolveTo = (address: string) => (async () => [{ address, family: address.includes(":") ? 6 : 4 }]) as never;

  it("refuses a public-looking name that resolves inside", async () => {
    await expect(assertPublicUrl("https://127.0.0.1.nip.io/x.yaml", resolveTo("127.0.0.1"))).rejects.toThrow(/private network/);
    await expect(assertPublicUrl("ssh://git@git.example.com/x.git", resolveTo("::ffff:10.1.2.3"))).rejects.toThrow(/private network/);
  });

  it("allows a name that resolves to a public address, and local paths", async () => {
    await expect(assertPublicUrl("https://git.example.com/x.git", resolveTo("93.184.216.34"))).resolves.toBeUndefined();
    await expect(assertPublicUrl("file:///srv/x.git", resolveTo("127.0.0.1"))).resolves.toBeUndefined();
  });
});

describe("source URL grammar", () => {
  it.each([
    "ssh://git@github.com:22@127.0.0.2/x.git",
    "ssh://git:pw@github.com/x.git",
    "ssh://a@b@127.0.0.1/x.git",
    "git@github.com:22@127.0.0.2:x.git",
    "a@b@127.0.0.1:x.git",
    "https://user@github.com/x.git",
    "https://u:p@github.com/x.git",
    "ssh://git@github.com\\@127.0.0.1/x.git",
    "ssh://git@[::1]/x.git",
    "ssh://git@github.com:99999999/x.git",
    "git://github.com/x.git",
    "ssh://git@-oProxyCommand=id/x.git",
  ])("refuses %s", (url) => {
    expect(isAllowedSourceUrl(url)).toBe(false);
  });

  it.each([
    ["ssh://git@github.com/team/x.git", "github.com"],
    ["ssh://git@git.example.com:2222/team/x.git", "git.example.com"],
    ["git@github.com:team/x.git", "github.com"],
    ["https://git.example.com/team/x.git", "git.example.com"],
  ])("reads %s as %s", (url, host) => {
    expect(hostOf(url)).toBe(host);
    expect(isAllowedSourceUrl(url)).toBe(true);
  });

  it("refuses every generated URL whose host ssh or curl could read differently", () => {
    const users = ["", "git@", "git:x@", "git@a@", "a:b:c@", "g%40@", "git@github.com:22@"];
    const hosts = ["github.com", "127.0.0.2", "127.1", "[::ffff:127.0.0.1]", "github.com.", "localhost"];
    const ports = ["", ":22", ":22@127.0.0.2", ":x"];
    for (const user of users)
      for (const host of hosts)
        for (const port of ports)
          for (const form of ["ssh", "scp", "https"] as const) {
            const url =
              form === "ssh" ? `ssh://${user}${host}${port}/team/x.git` : form === "https" ? `https://${user}${host}${port}/team/x.git` : `${user}${host}${port}:team/x.git`;
            const authority = form === "scp" ? url.slice(0, url.lastIndexOf(":team")) : url.split("://")[1]!.split("/")[0]!;
            // The host ssh connects to is after the last "@"; the guard must agree or refuse.
            const sshHost = authority.slice(authority.lastIndexOf("@") + 1).replace(/:[^\]]*$/, "");
            const allowed = isAllowedSourceUrl(url);
            if (allowed) {
              expect({ url, publicSshHost: !isInternalHost(sshHost), atCount: (authority.match(/@/g) ?? []).length <= 1 }).toEqual({ url, publicSshHost: true, atCount: true });
            }
          }
  });
});

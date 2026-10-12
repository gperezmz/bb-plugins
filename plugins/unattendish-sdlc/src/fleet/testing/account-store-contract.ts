// The AccountStore port's behaviour as one suite, run over every implementation so the in-memory fake cannot drift
// from the SQLite store.
import { describe, expect, it } from "vitest";
import type { AccountStore } from "../application/ports";
import type { Account, AccountCredential } from "../domain/accounts";

const account = (id: string, over: Partial<Account> = {}): Account => ({ id, service: "github", place: "github.com", login: id, name: id, via: "token", apiUrl: null, addedAt: `2026-10-12T10:00:0${id.length % 10}.000Z`, ...over });
const credential = (id: string, accountId: string, over: Partial<AccountCredential> = {}): AccountCredential => ({ id, accountId, kind: "fine-grained", owner: "acme", expiresAt: null, addedAt: "2026-10-12T10:00:00.000Z", ...over });

export function describeAccountStore(name: string, make: () => { store: AccountStore; close?: () => void }): void {
  describe(`${name} as an AccountStore`, () => {
    const withStore = (test: (store: AccountStore) => void) => () => {
      const { store, close } = make();
      try {
        test(store);
      } finally {
        close?.();
      }
    };

    it(
      "keeps accounts, credentials and assignments, and never hands a token back but through tokenOf and tokens",
      withStore((store) => {
        store.addAccount(account("yuser"));
        store.saveCredential(credential("c1", "yuser"), "secret-1");
        store.assign("github.com", "yuser");
        expect(store.accounts().map((a) => a.id)).toEqual(["yuser"]);
        expect(store.credentials()).toEqual([credential("c1", "yuser")]);
        expect(JSON.stringify(store.credentials())).not.toContain("secret-1");
        expect(store.assignments()).toEqual([{ scope: "github.com", accountId: "yuser" }]);
        expect(store.tokenOf("c1")).toBe("secret-1");
        expect(store.tokens()).toEqual(["secret-1"]);
      }),
    );

    it(
      "replaces a GitHub credential for the same owner, whatever its case, and keeps those for other owners",
      withStore((store) => {
        store.addAccount(account("yuser"));
        store.saveCredential(credential("c1", "yuser", { owner: "acme" }), "old");
        store.saveCredential(credential("c2", "yuser", { owner: "zorg" }), "other");
        store.saveCredential(credential("c3", "yuser", { owner: "ACME" }), "new");
        expect(store.credentials().map((c) => c.id).sort()).toEqual(["c2", "c3"]);
        expect(store.tokens().sort()).toEqual(["new", "other"]);
      }),
    );

    it(
      "replaces any credential of an account off GitHub",
      withStore((store) => {
        store.addAccount(account("gl", { service: "gitlab", place: "gitlab.example.com" }));
        store.saveCredential(credential("c1", "gl", { kind: "gitlab-token", owner: null }), "old");
        store.saveCredential(credential("c2", "gl", { kind: "gitlab-token", owner: null }), "new");
        expect(store.credentials().map((c) => c.id)).toEqual(["c2"]);
        expect(store.tokenOf("c1")).toBeNull();
      }),
    );

    it(
      "removing an account deletes its tokens, its assignments and the access problems of its credentials",
      withStore((store) => {
        store.addAccount(account("yuser"));
        store.addAccount(account("buser"));
        store.saveCredential(credential("c1", "yuser"), "secret-1");
        store.saveCredential(credential("c2", "buser"), "secret-2");
        store.assign("github.com", "yuser");
        store.assign("github.com/zorg", "buser");
        store.setAccessProblem("github.com/acme/api", "forge", { credentialId: "c1", why: "not-found", at: "2026-10-12T10:00:00.000Z" });
        store.removeAccount("yuser");
        expect(store.accounts().map((a) => a.id)).toEqual(["buser"]);
        expect(store.tokens()).toEqual(["secret-2"]);
        expect(store.assignments()).toEqual([{ scope: "github.com/zorg", accountId: "buser" }]);
        expect(store.accessProblems("github.com/acme/api")).toEqual([]);
      }),
    );

    it(
      "removing a credential deletes its token",
      withStore((store) => {
        store.addAccount(account("yuser"));
        store.saveCredential(credential("c1", "yuser"), "secret-1");
        store.removeCredential("c1");
        expect(store.credentials()).toEqual([]);
        expect(store.tokens()).toEqual([]);
      }),
    );

    it(
      "an assignment replaces the one on the same scope, whatever its case, and unassign removes it",
      withStore((store) => {
        store.assign("github.com/Zorg", "yuser");
        store.assign("github.com/zorg", "buser");
        expect(store.assignments()).toEqual([{ scope: "github.com/zorg", accountId: "buser" }]);
        store.unassign("GITHUB.COM/ZORG");
        expect(store.assignments()).toEqual([]);
      }),
    );

    it(
      "notes an expiry, and keeps one access problem per fleet and role",
      withStore((store) => {
        store.addAccount(account("yuser"));
        store.saveCredential(credential("c1", "yuser"), "t");
        store.noteExpiry("c1", "2026-12-01T00:00:00.000Z");
        expect(store.credentials()[0]!.expiresAt).toBe("2026-12-01T00:00:00.000Z");
        store.setAccessProblem("r", "forge", { credentialId: "c1", why: "not-found", at: "a" });
        store.setAccessProblem("r", "forge", { credentialId: "c1", why: "forbidden", at: "b" });
        expect(store.accessProblems("r")).toEqual([{ role: "forge", credentialId: "c1", why: "forbidden", at: "b" }]);
        store.setAccessProblem("r", "forge", null);
        expect(store.accessProblems("r")).toEqual([]);
      }),
    );
  });
}

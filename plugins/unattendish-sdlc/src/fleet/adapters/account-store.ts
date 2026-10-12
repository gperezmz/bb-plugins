// The accounts, their credentials and the assignments, on the plugin's SQLite
// database beside the fleets. `account_credentials.token` is the only column
// that holds a token: it is read back by `tokenOf` and `tokens` alone, no row
// this class returns carries it, and a deleted one is overwritten on disk.
import type Database from "better-sqlite3";
import type { AccessProblem, AccountStore } from "../application/ports";
import { scopeKey, type Account, type AccountCredential, type Assignment } from "../domain/accounts";
import type { SourceRole } from "../domain/model";

interface AccountRow {
  id: string;
  service: Account["service"];
  place: string;
  login: string;
  name: string;
  via: Account["via"];
  api_url: string | null;
  added_at: string;
}

interface CredentialRow {
  id: string;
  account_id: string;
  kind: AccountCredential["kind"];
  owner: string | null;
  expires_at: string | null;
  added_at: string;
}

const toAccount = (row: AccountRow): Account => ({ id: row.id, service: row.service, place: row.place, login: row.login, name: row.name, via: row.via, apiUrl: row.api_url, addedAt: row.added_at });
const toCredential = (row: CredentialRow): AccountCredential => ({ id: row.id, accountId: row.account_id, kind: row.kind, owner: row.owner, expiresAt: row.expires_at, addedAt: row.added_at });

export class SqliteAccounts implements AccountStore {
  constructor(private readonly db: Database.Database) {
    // A removed token is overwritten on disk, not left in the database's free pages.
    db.pragma("secure_delete = ON");
  }

  accounts(): Account[] {
    return (this.db.prepare("SELECT * FROM accounts ORDER BY added_at, id").all() as AccountRow[]).map(toAccount);
  }

  credentials(): AccountCredential[] {
    return (this.db.prepare("SELECT id, account_id, kind, owner, expires_at, added_at FROM account_credentials ORDER BY added_at, id").all() as CredentialRow[]).map(toCredential);
  }

  assignments(): Assignment[] {
    return (this.db.prepare("SELECT scope, account_id FROM assignments ORDER BY scope_key").all() as { scope: string; account_id: string }[]).map((row) => ({ scope: row.scope, accountId: row.account_id }));
  }

  addAccount(account: Account): void {
    this.db
      .prepare("INSERT INTO accounts (id, service, place, login, name, via, api_url, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(account.id, account.service, account.place, account.login, account.name, account.via, account.apiUrl, account.addedAt);
  }

  removeAccount(accountId: string): void {
    this.forgetting(() => {
      this.db.prepare("DELETE FROM access_problems WHERE credential_id IN (SELECT id FROM account_credentials WHERE account_id = ?)").run(accountId);
      this.db.prepare("DELETE FROM account_credentials WHERE account_id = ?").run(accountId);
      this.db.prepare("DELETE FROM assignments WHERE account_id = ?").run(accountId);
      this.db.prepare("DELETE FROM accounts WHERE id = ?").run(accountId);
    });
  }

  saveCredential(credential: AccountCredential, token: string | null): void {
    // A credential it replaces, a Renew's old token among them, is deleted as Remove deletes one.
    this.forgetting(() => {
      const service = (this.db.prepare("SELECT service FROM accounts WHERE id = ?").get(credential.accountId) as { service: string } | undefined)?.service;
      const replaced =
        service === "github"
          ? (this.db.prepare("SELECT id FROM account_credentials WHERE account_id = ? AND ((owner IS NULL AND ? IS NULL) OR lower(owner) = lower(?))").all(credential.accountId, credential.owner, credential.owner) as { id: string }[])
          : (this.db.prepare("SELECT id FROM account_credentials WHERE account_id = ?").all(credential.accountId) as { id: string }[]);
      for (const { id } of replaced) this.drop(id);
      this.db
        .prepare("INSERT INTO account_credentials (id, account_id, kind, owner, token, expires_at, added_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(credential.id, credential.accountId, credential.kind, credential.owner, token, credential.expiresAt, credential.addedAt);
    });
  }

  removeCredential(credentialId: string): void {
    this.forgetting(() => this.drop(credentialId));
  }

  /**
   * Runs a deletion of tokens, then checkpoints the write-ahead log into the database and truncates it, so a deleted
   * token is left neither in the log nor, with `secure_delete`, in the database's free pages. A checkpoint a reader
   * holds back leaves the log to the next.
   */
  private forgetting(work: () => void): void {
    this.db.transaction(work)();
    this.db.pragma("wal_checkpoint(TRUNCATE)");
  }

  private drop(credentialId: string): void {
    this.db.prepare("DELETE FROM access_problems WHERE credential_id = ?").run(credentialId);
    this.db.prepare("DELETE FROM account_credentials WHERE id = ?").run(credentialId);
  }

  tokenOf(credentialId: string): string | null {
    return (this.db.prepare("SELECT token FROM account_credentials WHERE id = ?").get(credentialId) as { token: string | null } | undefined)?.token ?? null;
  }

  tokens(): string[] {
    return (this.db.prepare("SELECT token FROM account_credentials WHERE token IS NOT NULL").all() as { token: string }[]).map((row) => row.token);
  }

  noteExpiry(credentialId: string, expiresAt: string | null): void {
    this.db.prepare("UPDATE account_credentials SET expires_at = ? WHERE id = ?").run(expiresAt, credentialId);
  }

  assign(scope: string, accountId: string): void {
    this.db.prepare("INSERT INTO assignments (scope_key, scope, account_id) VALUES (?, ?, ?) ON CONFLICT (scope_key) DO UPDATE SET scope = excluded.scope, account_id = excluded.account_id").run(scopeKey(scope), scope.trim(), accountId);
  }

  unassign(scope: string): void {
    this.db.prepare("DELETE FROM assignments WHERE scope_key = ?").run(scopeKey(scope));
  }

  accessProblems(repo: string): AccessProblem[] {
    return (this.db.prepare("SELECT role, credential_id, why, at FROM access_problems WHERE repo_id = ? ORDER BY role").all(repo) as { role: SourceRole; credential_id: string; why: AccessProblem["why"]; at: string }[]).map((row) => ({
      role: row.role,
      credentialId: row.credential_id,
      why: row.why,
      at: row.at,
    }));
  }

  setAccessProblem(repo: string, role: SourceRole, problem: Omit<AccessProblem, "role"> | null): void {
    if (problem === null) this.db.prepare("DELETE FROM access_problems WHERE repo_id = ? AND role = ?").run(repo, role);
    else
      this.db
        .prepare("INSERT INTO access_problems (repo_id, role, credential_id, why, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (repo_id, role) DO UPDATE SET credential_id = excluded.credential_id, why = excluded.why, at = excluded.at")
        .run(repo, role, problem.credentialId, problem.why, problem.at);
  }
}

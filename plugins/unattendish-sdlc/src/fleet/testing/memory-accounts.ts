// The AccountStore port in memory, for use case tests. `account-store-contract.ts` runs one suite over it and the
// SQLite store, so the two cannot drift.
import type { AccessProblem, AccountStore } from "../application/ports";
import { scopeKey, type Account, type AccountCredential, type Assignment } from "../domain/accounts";
import type { SourceRole } from "../domain/model";

export class InMemoryAccounts implements AccountStore {
  private readonly accountList: Account[] = [];
  private credentialList: { credential: AccountCredential; token: string | null }[] = [];
  private readonly assigned = new Map<string, Assignment>();
  private readonly problems = new Map<string, AccessProblem>();

  accounts(): Account[] {
    return [...this.accountList].sort((a, b) => (a.addedAt === b.addedAt ? (a.id < b.id ? -1 : 1) : a.addedAt < b.addedAt ? -1 : 1));
  }

  credentials(): AccountCredential[] {
    return this.credentialList.map((entry) => entry.credential).sort((a, b) => (a.addedAt === b.addedAt ? (a.id < b.id ? -1 : 1) : a.addedAt < b.addedAt ? -1 : 1));
  }

  assignments(): Assignment[] {
    return [...this.assigned.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, assignment]) => assignment);
  }

  addAccount(account: Account): void {
    if (this.accountList.some((known) => known.id === account.id)) throw new Error(`account ${account.id} exists`);
    this.accountList.push(account);
  }

  removeAccount(accountId: string): void {
    for (const entry of this.credentialList.filter((e) => e.credential.accountId === accountId)) this.drop(entry.credential.id);
    for (const [key, assignment] of this.assigned) if (assignment.accountId === accountId) this.assigned.delete(key);
    const at = this.accountList.findIndex((account) => account.id === accountId);
    if (at !== -1) this.accountList.splice(at, 1);
  }

  saveCredential(credential: AccountCredential, token: string | null): void {
    const service = this.accountList.find((account) => account.id === credential.accountId)?.service;
    const owner = credential.owner?.toLowerCase() ?? null;
    for (const entry of this.credentialList.filter((e) => e.credential.accountId === credential.accountId && (service !== "github" || (e.credential.owner?.toLowerCase() ?? null) === owner))) this.drop(entry.credential.id);
    this.credentialList.push({ credential, token });
  }

  removeCredential(credentialId: string): void {
    this.drop(credentialId);
  }

  private drop(credentialId: string): void {
    this.credentialList = this.credentialList.filter((entry) => entry.credential.id !== credentialId);
    for (const [key, problem] of this.problems) if (problem.credentialId === credentialId) this.problems.delete(key);
  }

  tokenOf(credentialId: string): string | null {
    return this.credentialList.find((entry) => entry.credential.id === credentialId)?.token ?? null;
  }

  tokens(): string[] {
    return this.credentialList.flatMap((entry) => (entry.token === null ? [] : [entry.token]));
  }

  noteExpiry(credentialId: string, expiresAt: string | null): void {
    this.credentialList = this.credentialList.map((entry) => (entry.credential.id === credentialId ? { ...entry, credential: { ...entry.credential, expiresAt } } : entry));
  }

  assign(scope: string, accountId: string): void {
    this.assigned.set(scopeKey(scope), { scope: scope.trim(), accountId });
  }

  unassign(scope: string): void {
    this.assigned.delete(scopeKey(scope));
  }

  accessProblems(repo: string): AccessProblem[] {
    return [...this.problems.entries()]
      .filter(([key]) => key.startsWith(`${repo}\u0000`))
      .map(([, problem]) => problem)
      .sort((a, b) => (a.role < b.role ? -1 : 1));
  }

  setAccessProblem(repo: string, role: SourceRole, problem: Omit<AccessProblem, "role"> | null): void {
    const key = `${repo}\u0000${role}`;
    if (problem === null) this.problems.delete(key);
    else this.problems.set(key, { role, ...problem });
  }
}

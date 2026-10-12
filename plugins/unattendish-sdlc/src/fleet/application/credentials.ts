// Credentials from the plugin's accounts. A fleet's half reads as the account
// the most specific assignment covering it names, with that account's
// credential reaching its owner: there is no fallback to another account, to a
// `gh` or `glab` login that was not chosen, or to an environment variable. A
// `gh` or `glab` account reads only as its own login.
import { accountLabel, apiOf, forgeHalf, readerOf, trackerHalf, type Account, type Half } from "../domain/accounts";
import type { RepoRef, TrackerSpec } from "../domain/model";
import type { LoginStatus } from "./accounts";
import { CredentialUnavailable, type AccountStore, type CliLogins, type Clock, type CredentialLookup, type Credentials, type ResolvedCredential, type ServiceProbe } from "./ports";
import { resolvedOf } from "./resolved";

/** How long a token obtained from `gh` or `glab` is kept before the CLI is asked again. */
export const CLI_TOKEN_TTL_MS = 5 * 60_000;
/**
 * How long a failed lookup of a CLI token is remembered. The dashboard asks for a fleet's token on every refresh of a
 * page, and a missing `gh` or `glab` login would run the CLI (up to its timeout) for each fleet each time.
 */
export const CLI_FAILURE_TTL_MS = 30_000;

/** `gh is signed in as yuser, not buser`: what an account using a login another user's token came from shows. */
export const loginMismatchText = (tool: "gh" | "glab", got: string, wanted: string): string => `${tool} is signed in as ${got}, not ${wanted}`;

interface CliToken {
  readonly token: string;
  readonly until: number;
}

/** Looks a fleet's credentials up among the plugin's accounts and obtains their tokens. */
export class AccountCredentials implements Credentials, LoginStatus {
  private readonly cliTokens = new Map<string, CliToken>();
  /** By account, when a failed lookup stops being remembered (epoch milliseconds), and why it failed. */
  private readonly cliFailures = new Map<string, { readonly until: number; readonly reason: string }>();
  /** Every token a CLI has given, kept after its cache entry expires so text can still be scrubbed of it. */
  private readonly cliSeen = new Set<string>();

  constructor(
    private readonly store: AccountStore,
    private readonly logins: CliLogins,
    private readonly probe: ServiceProbe,
    private readonly clock: Clock,
  ) {}

  forForge(repo: RepoRef): CredentialLookup {
    return this.lookup(repo, forgeHalf(repo, null));
  }

  forTracker(tracker: TrackerSpec, repo: RepoRef): CredentialLookup {
    const half = trackerHalf(tracker);
    return half === null ? this.forForge(repo) : this.lookup(repo, half);
  }

  private lookup(repo: RepoRef, half: Half): CredentialLookup {
    const accounts = this.store.accounts();
    const reader = readerOf(repo, half, accounts, this.store.assignments(), this.store.credentials());
    if (reader.kind === "needs") return { found: false, account: reader.account === null ? null : { id: reader.account.id, label: accountLabel(reader.account) }, need: reader.need };
    return { found: true, credential: resolvedOf(reader.account, reader.credential) };
  }

  /** Why an account using a login cannot read now, as last found; null while it can or nothing was asked. */
  loginProblem(accountId: string): string | null {
    const failed = this.cliFailures.get(accountId);
    return failed !== undefined && failed.until > this.clock.now().getTime() ? failed.reason : null;
  }

  /** Forgets what was found of an account's login, so the next use asks the tool again. */
  forget(accountId: string): void {
    this.cliTokens.delete(accountId);
    this.cliFailures.delete(accountId);
  }

  async token(credential: ResolvedCredential): Promise<string> {
    if (credential.auth === "token") {
      const token = this.store.tokenOf(credential.key);
      if (token === null) throw new CredentialUnavailable(`No token is stored for ${credential.label}`);
      return token;
    }
    const account = this.store.accounts().find((candidate) => candidate.id === credential.accountId);
    if (account === undefined) throw new CredentialUnavailable(`No account holds ${credential.label}`);
    const now = this.clock.now().getTime();
    const cached = this.cliTokens.get(account.id);
    if (cached !== undefined && cached.until > now) return cached.token;
    const failed = this.cliFailures.get(account.id);
    if (failed !== undefined && failed.until > now) throw new CredentialUnavailable(failed.reason);
    try {
      const token = await this.loginToken(account, credential.auth as "gh" | "glab");
      this.cliFailures.delete(account.id);
      this.cliTokens.set(account.id, { token, until: now + CLI_TOKEN_TTL_MS });
      return token;
    } catch (error) {
      const reason = error instanceof CredentialUnavailable ? error.message : `${credential.auth} gave no token for ${account.place}`;
      this.cliFailures.set(account.id, { until: now + CLI_FAILURE_TTL_MS, reason });
      throw new CredentialUnavailable(reason);
    }
  }

  /** The token the tool gives for the account's login, once the service says it is that login's. */
  private async loginToken(account: Account, tool: "gh" | "glab"): Promise<string> {
    const token = await this.logins.token(tool, account.place, account.login);
    this.cliSeen.add(token);
    const identified = await this.probe.identify({ service: account.service, ...apiOf(account) }, token);
    // A service that does not answer says nothing of whose the token is; the read that follows meets the same outage.
    if (identified.ok && identified.login.toLowerCase() !== account.login.toLowerCase()) throw new CredentialUnavailable(loginMismatchText(tool, identified.login, account.login));
    return token;
  }

  secrets(): string[] {
    return [...new Set([...this.store.tokens(), ...this.cliSeen])];
  }
}

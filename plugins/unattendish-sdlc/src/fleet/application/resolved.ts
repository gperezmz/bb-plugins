// A credential of an account as the reads use it.
import { accountLabel, apiOf, credentialLabel, type Account, type AccountCredential } from "../domain/accounts";
import type { ResolvedCredential } from "./ports";

export const resolvedOf = (account: Account, credential: AccountCredential): ResolvedCredential => ({
  key: credential.id,
  label: credentialLabel(account, credential),
  accountId: account.id,
  accountLabel: accountLabel(account),
  service: account.service,
  auth: account.via,
  kind: credential.kind,
  ...apiOf(account),
});

// The settings section's changes to accounts, each followed by a refetch, with the server's refusal or the notice to show.
import { useState } from "react";
import type { RevokeNotice, Result } from "@/src/fleet/application/views";
import { useDashboardApi } from "@/shared/client";
import { messageOf } from "@/shared/errors";

/** What is being asked to be removed: a credential or an account, by id. */
export interface PendingRemoval {
  readonly kind: "credential" | "account";
  readonly id: string;
}

export interface AccountActions {
  /** Why the latest change was refused. */
  readonly refusal: string | null;
  /** After a Remove or a Renew: the old token still works at the service. */
  readonly notice: RevokeNotice | null;
  readonly asked: PendingRemoval | null;
  ask(asked: PendingRemoval | null): void;
  showNotice(notice: RevokeNotice | null): void;
  makeDefault(accountId: string): Promise<void>;
  removeAssignment(scope: string): Promise<void>;
  removeCredential(credentialId: string): Promise<void>;
  removeAccount(accountId: string): Promise<void>;
}

export function useAccountActions(refetch: () => Promise<void>): AccountActions {
  const api = useDashboardApi();
  const [refusal, setRefusal] = useState<string | null>(null);
  const [notice, setNotice] = useState<RevokeNotice | null>(null);
  const [asked, setAsked] = useState<PendingRemoval | null>(null);

  async function change<T extends { revoke?: RevokeNotice | null }>(call: () => Promise<Result<T>>): Promise<void> {
    setRefusal(null);
    try {
      const result = await call();
      if (result.ok) {
        setNotice(result.revoke ?? null);
        await refetch();
      } else {
        setRefusal(result.reason);
      }
    } catch (error) {
      setRefusal(messageOf(error));
    }
    setAsked(null);
  }

  return {
    refusal,
    notice,
    asked,
    ask: setAsked,
    showNotice: setNotice,
    makeDefault: (accountId) => change(() => api.makeDefault({ accountId })),
    removeAssignment: (scope) => change(() => api.removeAssignment({ scope })),
    removeCredential: (credentialId) => change(() => api.removeCredential({ credentialId })),
    removeAccount: (accountId) => change(() => api.removeAccount({ accountId })),
  };
}

import { useEffect } from "react";
import { UrlLink } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { useDashboardApi } from "@/shared/client";
import { messageOf } from "@/shared/errors";
import { onConnectSaved, openConnect } from "@/shared/connect/requests";
import { LINK_CLASS } from "@/shared/ItemLink";
import { LiveScreen } from "@/shared/LiveScreen";
import { useLive } from "@/shared/use-live";
import { AccountItem } from "./AccountItem";
import { IntervalRow } from "./IntervalRow";
import { ADD_ACCOUNT } from "./model";
import { useAccountActions } from "./use-account-actions";

/** The plugin's settings section: the accounts as cards with their tokens and assignments, and a table of each fleet's poll interval. */
export function AccountsSettings() {
  const api = useDashboardApi();
  const live = useLive(() => api.settings(), [api]);
  const actions = useAccountActions(live.refetch);
  const { refetch } = live;
  const { showNotice } = actions;

  // The popup stores an account or a token in a window of its own; the list follows at once.
  useEffect(
    () =>
      onConnectSaved((revoke) => {
        if (revoke !== null) showNotice(revoke);
        void refetch();
      }),
    [refetch, showNotice],
  );

  async function setInterval(repo: string, seconds: number | null): Promise<string | null> {
    try {
      const result = await api.setInterval({ repo, seconds });
      if (!result.ok) return result.reason;
      await live.refetch();
      return null;
    } catch (error) {
      return messageOf(error);
    }
  }

  return (
    <div className="flex flex-col gap-6 text-sm">
      <LiveScreen live={live} what="the accounts">
        {(settings) => (
          <>
            <section aria-labelledby="settings-accounts" className="flex flex-col gap-2">
              <h3 id="settings-accounts" className="font-semibold">
                Accounts
              </h3>
              {settings.accounts.length === 0 ? <p className="text-muted-foreground">No account is connected.</p> : null}
              <ul className="flex flex-col gap-3">
                {settings.accounts.map((account) => (
                  <AccountItem key={account.id} account={account} actions={actions} />
                ))}
              </ul>
              {actions.refusal !== null ? (
                <p role="alert" className="text-destructive-text">
                  {actions.refusal}
                </p>
              ) : null}
              {actions.notice !== null ? (
                <p role="status" className="text-xs text-muted-foreground">
                  {actions.notice.text}{" "}
                  <UrlLink href={actions.notice.url} className={LINK_CLASS}>
                    Open the token page ↗
                  </UrlLink>
                </p>
              ) : null}
              <div>
                <Button type="button" variant="outline" size="sm" onClick={() => openConnect(ADD_ACCOUNT)}>
                  Add account
                </Button>
              </div>
            </section>
            <section aria-labelledby="settings-intervals" className="flex flex-col gap-2">
              <h3 id="settings-intervals" className="font-semibold">
                Poll interval
              </h3>
              {settings.fleets.length === 0 ? (
                <p className="text-muted-foreground">No fleet is registered.</p>
              ) : (
                <table aria-labelledby="settings-intervals" className="w-full border-collapse text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr className="border-b border-border">
                      <th scope="col" className="py-1.5 pr-3 font-medium">
                        Fleet
                      </th>
                      <th scope="col" className="py-1.5 pr-3 font-medium">
                        Interval
                      </th>
                      <th scope="col" className="py-1.5 font-medium">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {settings.fleets.map((fleet) => (
                      <IntervalRow key={`${fleet.repo}:${fleet.intervalMs}:${fleet.isDefault}`} repo={fleet.repo} forge={fleet.forge} intervalMs={fleet.intervalMs} isDefault={fleet.isDefault} onSet={(seconds) => setInterval(fleet.repo, seconds)} />
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </>
        )}
      </LiveScreen>
    </div>
  );
}

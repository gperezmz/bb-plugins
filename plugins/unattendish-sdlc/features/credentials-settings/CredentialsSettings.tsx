import { useState } from "react";
import type { CredentialSettingView } from "@/src/fleet/application/views";
import { Button } from "@/components/ui/button";
import { useDashboardApi } from "@/shared/client";
import { messageOf } from "@/shared/errors";
import { LiveScreen } from "@/shared/LiveScreen";
import { useLive } from "@/shared/use-live";
import { CredentialForm } from "./CredentialForm";
import { IntervalRow } from "./IntervalRow";
import { draftFrom, emptyForm, formFrom, settingParts, type Form } from "./model";

/** The plugin's settings section: the credentials, and each fleet's poll interval. */
export function CredentialsSettings() {
  const api = useDashboardApi();
  const live = useLive(() => api.settings(), [api]);
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeRefusal, setRemoveRefusal] = useState<string | null>(null);

  async function save(token: string): Promise<void> {
    if (form === null) return;
    setSaving(true);
    setRefusal(null);
    // The field was cleared as the token was read, so a refusal leaves it empty to be typed again.
    setForm({ ...form, tokenTyped: false });
    try {
      const result = await api.saveCredential(draftFrom(form, token));
      if (result.ok) {
        setForm(null);
        await live.refetch();
      } else {
        setRefusal(result.reason);
      }
    } catch (error) {
      setRefusal(messageOf(error));
    } finally {
      setSaving(false);
    }
  }

  async function remove(prefix: string): Promise<void> {
    setRemoveRefusal(null);
    try {
      const result = await api.removeCredential({ prefix });
      if (result.ok) await live.refetch();
      else setRemoveRefusal(result.reason);
    } catch (error) {
      setRemoveRefusal(messageOf(error));
    }
    setRemoving(null);
  }

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
      <p className="text-muted-foreground">
        The credentials and tokens settings above edit the same list as this section. Here a token is write-only: it is stored, never shown, and a blank field keeps the stored one.
      </p>
      <LiveScreen live={live} what="the credentials">
        {(settings) => (
          <>
            {settings.problems.length > 0 ? (
              <ul className="flex flex-col gap-1 text-warning">
                {settings.problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            ) : null}
            <section aria-labelledby="settings-credentials" className="flex flex-col gap-2">
              <h3 id="settings-credentials" className="font-semibold">
                Credentials
              </h3>
              {settings.credentials.length === 0 ? <p className="text-muted-foreground">No credential is set.</p> : null}
              <ul className="flex flex-col gap-2">
                {settings.credentials.map((credential) => (
                  <CredentialItem
                    key={credential.prefix}
                    credential={credential}
                    confirming={removing === credential.prefix}
                    onEdit={() => {
                      setRefusal(null);
                      setForm(formFrom(credential));
                    }}
                    onAskRemove={() => setRemoving(credential.prefix)}
                    onKeep={() => setRemoving(null)}
                    onRemove={() => void remove(credential.prefix)}
                  />
                ))}
              </ul>
              {removeRefusal !== null ? (
                <p role="alert" className="text-destructive">
                  {removeRefusal}
                </p>
              ) : null}
              {form !== null ? (
                <CredentialForm form={form} onChange={setForm} onSave={(token) => void save(token)} onCancel={() => setForm(null)} saving={saving} refusal={refusal} />
              ) : (
                <div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setRefusal(null);
                      setForm(emptyForm());
                    }}
                  >
                    Add a credential
                  </Button>
                </div>
              )}
            </section>
            <section aria-labelledby="settings-intervals" className="flex flex-col gap-2">
              <h3 id="settings-intervals" className="font-semibold">
                Poll interval
              </h3>
              {settings.fleets.length === 0 ? (
                <p className="text-muted-foreground">No fleet is registered.</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {settings.fleets.map((fleet) => (
                    <IntervalRow key={`${fleet.repo}:${fleet.intervalMs}:${fleet.isDefault}`} repo={fleet.repo} intervalMs={fleet.intervalMs} isDefault={fleet.isDefault} onSet={(seconds) => setInterval(fleet.repo, seconds)} />
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </LiveScreen>
    </div>
  );
}

function CredentialItem({
  credential,
  confirming,
  onEdit,
  onAskRemove,
  onKeep,
  onRemove,
}: {
  credential: CredentialSettingView;
  confirming: boolean;
  onEdit(): void;
  onAskRemove(): void;
  onKeep(): void;
  onRemove(): void;
}) {
  return (
    <li className="flex flex-col gap-1 rounded-md border border-border p-2">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <span className="font-medium">{credential.prefix}</span>
        {settingParts(credential).map((part) => (
          <span key={part} className="text-muted-foreground">
            {part}
          </span>
        ))}
      </div>
      {credential.problem !== null ? <p className="text-xs text-destructive">cannot be used: {credential.problem}</p> : null}
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <span>Remove {credential.prefix}?</span>
          <Button type="button" size="sm" variant="destructive" aria-label={`Confirm removing ${credential.prefix}`} onClick={onRemove}>
            Remove
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onKeep}>
            Keep
          </Button>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" aria-label={`Edit ${credential.prefix}`} onClick={onEdit}>
            Edit
          </Button>
          <Button type="button" size="sm" variant="outline" aria-label={`Remove ${credential.prefix}`} onClick={onAskRemove}>
            Remove
          </Button>
        </div>
      )}
    </li>
  );
}

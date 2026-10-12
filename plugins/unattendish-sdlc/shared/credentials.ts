// How a credential is spelled, in the Fleet tab.
import type { FleetCredentialView } from "@/src/fleet/application/views";

const KINDS: Readonly<Record<FleetCredentialView["kind"], string>> = {
  "fine-grained": "fine-grained token",
  classic: "classic token",
  "gitlab-token": "personal access token",
  "linear-key": "API key",
  "jira-token": "API token",
  gh: "gh login",
  glab: "glab login",
};

/** What kind of credential it is. */
export function credentialKind(kind: FleetCredentialView["kind"]): string {
  return KINDS[kind];
}

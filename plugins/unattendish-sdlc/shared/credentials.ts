// How a credential is spelled, in the Fleet tab and in the settings section.
import type { FleetCredentialView } from "@/src/fleet/application/views";

/** What kind of credential it is. */
export function credentialKind(auth: FleetCredentialView["auth"]): string {
  switch (auth) {
    case "token":
      return "pasted token";
    case "gh":
      return "gh login";
    case "glab":
      return "glab login";
  }
}

// The icons the plugin draws, by what they stand for, so every surface draws one thing the same way. Each is a bb
// built-in icon name or one of the plugin's own, declared under bb.branding.experimental_icons in package.json and
// named `unattendish-sdlc/<name>`; bb paints a declared icon in the current text colour. A name that is neither draws
// bb's fallback, which `icons.test.ts` refuses.
import type { InboxRowView, ServiceKind } from "@/src/fleet/application/views";

type WaitsFor = InboxRowView["waitsFor"];

/** A declared icon's name as bb resolves it. */
export const own = (name: string): string => `unattendish-sdlc/${name}`;

/** The plugin's own icons, by their key under bb.branding.experimental_icons; the light bulb and scales are for the Fleet tab's stages. */
export const DECLARED_ICONS = ["circle-dashed", "fleet", "hammer", "hourglass", "key", "lightbulb", "rocket", "scale", "user-x"] as const;

export const ICONS = {
  fleet: own("fleet"),
  /** Opens a fleet's Fleet tab. */
  fleetTab: own("fleet"),

  // What a row waits for.
  answer: "MessageSquare",
  grant: "GitMerge",
  ready: own("rocket"),
  other: own("circle-dashed"),

  // The four Status counts.
  blocked: "Unavailable",
  inFlight: own("hammer"),
  waiting: "UserRound",
  landed: "GitMerge",

  // The manager's state.
  managerWorking: "Loading",
  managerIdle: "Coffee",
  managerNone: own("user-x"),

  // Polling, problems and warnings.
  neverPolled: own("hourglass"),
  late: "Clock",
  review: "AlertTriangle",
  connect: "ElectricPlugs",
  renew: own("key"),
  noFix: "CircleX",

  // The queue.
  age: "Clock",
  done: "Check",
  sending: "Loading",
  unreadable: "AlertTriangle",
  clear: "X",

  // The page's states.
  cantLoad: "CloudOff",
  reload: "RotateCcw",
  nothingWaits: "CircleCheck",
} as const;

export type IconRole = keyof typeof ICONS;

/** The icon of each kind of wait. */
export const KIND_ICONS: Readonly<Record<WaitsFor, string>> = { answer: ICONS.answer, grant: ICONS.grant, ready: ICONS.ready, other: ICONS.other };

/** The services a fleet's forge or tracker can be. */
export type Service = ServiceKind;

/**
 * The logo of each service that has one to show: GitHub's, which bb draws itself. GitLab's and Atlassian's trademark
 * rules refuse their logos to third parties, and Linear's forbids altering its files, which drawing them in the text
 * colour does, so those services show their names instead.
 */
export const SERVICE_LOGOS: Readonly<Partial<Record<Service, string>>> = { github: "GithubLogo" };

/** Each service's name, which a logo's accessible name reads as. */
export const SERVICE_NAMES: Readonly<Record<Service, string>> = { github: "GitHub", gitlab: "GitLab", linear: "Linear", jira: "Jira" };

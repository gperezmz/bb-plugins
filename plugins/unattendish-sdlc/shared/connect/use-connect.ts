// The popup's state and its calls to the server. The decisions are in `model.ts`; this carries them out.
// A token lives only in the field that holds it until it is sent. The one place it waits is `pending`, a ref
// the server's "is this your login?" question needs: it is dropped when the answer is given, when anything
// else is answered, and when the popup closes.
import { useEffect, useReducer, useRef } from "react";
import type { ConnectInput, ConnectResult, ConnectSecret } from "@/src/fleet/application/views";
import { useDashboardApi } from "../client";
import { messageOf } from "../errors";
import {
  accountOf,
  choiceFor,
  connectInput,
  connectReducer,
  goesStraight,
  initialState,
  loginTool,
  needsSetup,
  setupProblem,
  targetOf,
  type AccountChoice,
  type ConnectEvent,
  type ConnectState,
  type Service,
  type Setup,
  type Step,
} from "./model";
import { announceConnectSaved, type ConnectRequest } from "./requests";

export interface ConnectFlow {
  readonly state: ConnectState;
  /** Whether the check-again call has a fleet half to read. */
  readonly canCheck: boolean;
  editSetup(setup: Setup): void;
  submitSetup(): void;
  chooseService(service: Service): void;
  choose(option: string): void;
  verify(secret: ConnectSecret): void;
  confirm(): void;
  checkAgain(): void;
  back(to: Step): void;
}

export function useConnectFlow(request: ConnectRequest): ConnectFlow {
  const api = useDashboardApi();
  const [state, dispatch] = useReducer(connectReducer, request, initialState);
  const pending = useRef<ConnectInput | null>(null);
  // The latest state for the calls below, which run after awaits.
  const latest = useRef(state);
  latest.current = state;
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      pending.current = null;
    };
  }, []);
  const send = (event: ConnectEvent) => {
    if (alive.current) dispatch(event);
  };

  /** Fetches step 2's page for the account, and the logins the operator's `gh` or `glab` holds. */
  async function loadPage(setup: Setup, choice: AccountChoice, place: string, service: Service | null): Promise<void> {
    send({ type: "calling" });
    try {
      const answer = await api.tokenPage({ ...targetOf(request, setup), account: accountOf(choice) });
      if (!answer.ok) return send({ type: "failed", reason: answer.reason });
      const tool = service === null ? null : loginTool(service);
      const logins = tool === null ? [] : (await api.cliLogins({ tool, host: place }).catch(() => ({ logins: [] as readonly string[] }))).logins;
      send({ type: "paged", page: answer.page, logins });
    } catch (error) {
      send({ type: "failed", reason: messageOf(error) });
    }
  }

  /** Lists the accounts for the target, then opens the step that follows. */
  async function loadView(setup: Setup): Promise<void> {
    send({ type: "calling" });
    try {
      const answer = await api.connectView(targetOf(request, setup));
      if (!answer.ok) return send({ type: "failed", reason: answer.reason });
      const view = answer.connect;
      const asking = needsSetup(request);
      if (view.problem !== null) return send({ type: "viewed", view, step: asking ? "setup" : "account" });
      send({ type: "viewed", view, step: "account" });
      // A request that names its account, or a login typed by Add account, has nothing to choose.
      if (request.account !== undefined) {
        const named = choiceFor(view, request.account, null) ?? { kind: "existing" as const, id: request.account, label: "this account", reaches: false };
        send({ type: "chose", choice: named });
        await loadPage(setup, named, view.place, view.service);
      } else if (asking && view.service !== null) {
        const fresh: AccountChoice = { kind: "new", service: view.service, place: view.place };
        send({ type: "chose", choice: fresh });
        await loadPage(setup, fresh, view.place, view.service);
      }
    } catch (error) {
      send({ type: "failed", reason: messageOf(error) });
    }
  }

  async function run(input: ConnectInput): Promise<void> {
    send({ type: "calling" });
    try {
      const result: ConnectResult = await api.connect(input);
      pending.current = result.outcome === "confirm" ? input : null;
      send({ type: "resulted", result });
      if (result.outcome === "saved") announceConnectSaved(result.revoke);
    } catch (error) {
      pending.current = null;
      send({ type: "failed", reason: messageOf(error) });
    }
  }

  useEffect(() => {
    if (!needsSetup(request)) void loadView(latest.current.setup);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the popup is mounted once per request.
  }, []);

  return {
    state,
    canCheck: request.target.fleet !== undefined,
    editSetup: (setup) => send({ type: "setup-edited", setup }),
    submitSetup: () => {
      if (setupProblem(request, latest.current.setup) === null) void loadView(latest.current.setup);
    },
    chooseService: (service) => send({ type: "service-chosen", service }),
    choose: (option) => {
      const { view, chosenService, setup } = latest.current;
      if (view === null) return;
      const choice = choiceFor(view, option, chosenService);
      if (choice === null) return;
      send({ type: "chose", choice });
      if (goesStraight(choice, view)) void run(connectInput(request, setup, choice, { kind: "stored" }));
      else void loadPage(setup, choice, view.place, view.service ?? chosenService);
    },
    verify: (secret) => {
      const { choice, setup } = latest.current;
      if (choice !== null) void run(connectInput(request, setup, choice, secret));
    },
    confirm: () => {
      const input = pending.current;
      pending.current = null;
      if (input !== null) void run({ ...input, confirm: true });
    },
    checkAgain: () => {
      const { view } = latest.current;
      const fleet = request.target.fleet;
      const role = request.target.role ?? view?.role ?? null;
      if (fleet === undefined || role === null) return;
      send({ type: "calling" });
      void api
        .checkAgain({ fleet, role })
        .then((answer) => (answer.ok ? send({ type: "checked", checked: { half: answer.half, notReadable: answer.notReadable } }) : send({ type: "failed", reason: answer.reason })))
        .catch((error: unknown) => send({ type: "failed", reason: messageOf(error) }));
    },
    back: (to) => {
      pending.current = null;
      dispatch({ type: "back", to });
    },
  };
}

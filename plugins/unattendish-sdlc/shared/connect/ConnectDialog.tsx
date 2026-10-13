import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { AccountStep } from "./AccountStep";
import { ServiceLogo } from "../look/Glyph";
import { SERVICE_LOGOS } from "../look/icons";
import { dialogTitle, newLoginService, popupService, stepMarks, type ResultAction } from "./model";
import type { ConnectRequest } from "./requests";
import { ResultStep } from "./ResultStep";
import { SetupStep } from "./SetupStep";
import { StepMarker } from "./StepMarker";
import { TokenStep } from "./TokenStep";
import { useConnectFlow } from "./use-connect";

/** The Connect popup: which account, which credential, and what was found, under the service's logo and a marker of how far it has got. */
export function ConnectDialog({ request, onClose }: { request: ConnectRequest; onClose(): void }) {
  const flow = useConnectFlow(request);
  const { state } = flow;
  const service = state.choice?.kind === "new" ? state.choice.service : state.view !== null ? newLoginService(state.view, state.chosenService) : null;
  const titled = popupService(request, state);
  // Back to the account step, where the popup chose an account for a fleet rather than being opened for one.
  const back = request.account === undefined && state.view?.fleet != null ? () => flow.back("account") : undefined;
  const act = (action: ResultAction) => {
    if (action === "confirm") flow.confirm();
    else if (action === "check-again") flow.checkAgain();
    else if (action === "another-credential") flow.back("token");
    else flow.back("account");
  };
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <div className="flex flex-col gap-2">
          <DialogTitle className="flex items-center gap-2">
            {titled !== null ? <ServiceLogo service={titled} className={SERVICE_LOGOS[titled] !== undefined ? "size-5" : undefined} /> : null}{" "}
            {dialogTitle(request, state.view)}
          </DialogTitle>
          <StepMarker marks={stepMarks(state)} />
          <DialogDescription>{state.step === "result" ? "What was found." : "A read-only token is verified before it is stored."}</DialogDescription>
        </div>
        {state.step === "setup" ? (
          <SetupStep
            request={request}
            setup={state.setup}
            busy={state.busy}
            problem={state.view?.problem ?? null}
            onChange={flow.editSetup}
            onContinue={flow.submitSetup}
          />
        ) : null}
        {state.step === "account" && state.view === null && state.failure === null ? <p className="text-muted-foreground">Loading…</p> : null}
        {state.step === "account" && state.view !== null && state.view.problem !== null ? <p role="alert">{state.view.problem}</p> : null}
        {state.step === "account" && state.view !== null && state.view.problem === null ? (
          <AccountStep view={state.view} chosenService={state.chosenService} busy={state.busy} onService={flow.chooseService} onChoose={flow.choose} />
        ) : null}
        {state.step === "token" && state.choice !== null && state.page !== null && service !== null ? (
          <TokenStep key={state.choice.kind === "existing" ? state.choice.id : "new"} service={service} choice={state.choice} page={state.page} logins={state.logins} busy={state.busy} onVerify={flow.verify} onBack={back} />
        ) : null}
        {state.step === "result" && state.result !== null ? (
          <ResultStep result={state.result} checked={state.checked} canCheck={flow.canCheck} busy={state.busy} onAction={act} onClose={onClose} />
        ) : null}
        {state.busy && state.step !== "setup" ? <p className="text-xs text-muted-foreground">Working…</p> : null}
        {state.failure !== null ? (
          <p role="alert" className="text-sm text-destructive-text">
            {state.failure}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { AccountStep } from "./AccountStep";
import { dialogTitle, newLoginService, setupProblem, type ResultAction } from "./model";
import type { ConnectRequest } from "./requests";
import { ResultStep } from "./ResultStep";
import { SetupStep } from "./SetupStep";
import { TokenStep } from "./TokenStep";
import { useConnectFlow } from "./use-connect";

/** The Connect popup: which account, which credential, and what was found. */
export function ConnectDialog({ request, onClose }: { request: ConnectRequest; onClose(): void }) {
  const flow = useConnectFlow(request);
  const { state } = flow;
  const service = state.choice?.kind === "new" ? state.choice.service : state.view !== null ? newLoginService(state.view, state.chosenService) : null;
  const act = (action: ResultAction) => {
    if (action === "confirm") flow.confirm();
    else if (action === "check-again") flow.checkAgain();
    else if (action === "another-credential") flow.back("token");
    else flow.back("account");
  };
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogTitle>{dialogTitle(request, state.view)}</DialogTitle>
        <DialogDescription>{state.step === "result" ? "What was found." : "A read-only token is verified before it is stored."}</DialogDescription>
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
          <TokenStep key={state.choice.kind === "existing" ? state.choice.id : "new"} service={service} choice={state.choice} page={state.page} logins={state.logins} busy={state.busy} onVerify={flow.verify} />
        ) : null}
        {state.step === "result" && state.result !== null ? (
          <ResultStep result={state.result} checked={state.checked} canCheck={flow.canCheck} busy={state.busy} onAction={act} onClose={onClose} />
        ) : null}
        {state.busy && state.step !== "setup" ? <p className="text-xs text-muted-foreground">Working…</p> : null}
        {state.failure !== null ? (
          <p role="alert" className="text-sm text-destructive">
            {state.failure}
          </p>
        ) : null}
        {state.step === "token" && request.account === undefined && state.view?.fleet != null ? (
          <div>
            <Button type="button" size="sm" variant="ghost" onClick={() => flow.back("account")}>
              Choose another account
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

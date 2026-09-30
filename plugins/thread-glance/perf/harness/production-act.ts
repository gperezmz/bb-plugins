// React's production build ships no `act`, which Testing Library's render,
// and so renderSlot, calls. For the Chromium step, which times that build,
// `act` only runs its callback: the harness waits on the DOM instead.
import * as ReactNamespace from "react";

const React = ((ReactNamespace as { default?: object }).default ?? ReactNamespace) as { act?: unknown };
if (typeof React.act !== "function") {
  React.act = (callback: () => unknown) => {
    const result = callback();
    return result instanceof Promise ? result.then(() => undefined) : Promise.resolve();
  };
}

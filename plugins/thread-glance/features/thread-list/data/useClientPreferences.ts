// Per-client preferences: density, localStorage only.
import { useCallback, useEffect, useState } from "react";
import {
  CLIENT_PREFERENCES_STORAGE_KEY,
  parseClientPreferences,
  type ClientPreferences,
} from "@/shared/preferences";
import { sameWindow } from "./same-window";
import { readJson, writeJson } from "./storage";

const copies = sameWindow<Partial<ClientPreferences>>();

export function useClientPreferences(): [ClientPreferences, (patch: Partial<ClientPreferences>) => void] {
  const [value, setValue] = useState(() => parseClientPreferences(readJson(CLIENT_PREFERENCES_STORAGE_KEY)));
  const apply = useCallback((patch: Partial<ClientPreferences>) => setValue((current) => ({ ...current, ...patch })), []);
  useEffect(() => copies.join(apply), [apply]);
  const update = useCallback(
    (patch: Partial<ClientPreferences>) => {
      setValue((current) => {
        const next = { ...current, ...patch };
        writeJson(CLIENT_PREFERENCES_STORAGE_KEY, next);
        return next;
      });
      copies.tell(apply, patch);
    },
    [apply],
  );
  return [value, update];
}

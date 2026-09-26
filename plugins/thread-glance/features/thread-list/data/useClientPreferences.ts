// Per-client preferences: density, localStorage only.
import { useCallback, useState } from "react";
import {
  CLIENT_PREFERENCES_STORAGE_KEY,
  parseClientPreferences,
  type ClientPreferences,
} from "@/shared/preferences";
import { sameWindow, useSameWindow } from "./same-window";
import { readJson, writeJson } from "./storage";

const copies = sameWindow<Partial<ClientPreferences>>();

export function useClientPreferences(): [ClientPreferences, (patch: Partial<ClientPreferences>) => void] {
  const [value, setValue] = useState(() => parseClientPreferences(readJson(CLIENT_PREFERENCES_STORAGE_KEY)));
  const tellOthers = useSameWindow(copies, setValue);
  const update = useCallback(
    (patch: Partial<ClientPreferences>) => {
      setValue((current) => {
        const next = { ...current, ...patch };
        writeJson(CLIENT_PREFERENCES_STORAGE_KEY, next);
        return next;
      });
      tellOthers(patch);
    },
    [tellOthers],
  );
  return [value, update];
}

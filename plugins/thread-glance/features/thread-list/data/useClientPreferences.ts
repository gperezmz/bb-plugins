// Per-client preferences: density, localStorage only.
import { useCallback, useState } from "react";
import {
  CLIENT_PREFERENCES_STORAGE_KEY,
  parseClientPreferences,
  type ClientPreferences,
} from "@/shared/preferences";
import { readJson, writeJson } from "./storage";

export function useClientPreferences(): [ClientPreferences, (patch: Partial<ClientPreferences>) => void] {
  const [value, setValue] = useState(() => parseClientPreferences(readJson(CLIENT_PREFERENCES_STORAGE_KEY)));
  const update = useCallback((patch: Partial<ClientPreferences>) => {
    setValue((current) => {
      const next = { ...current, ...patch };
      writeJson(CLIENT_PREFERENCES_STORAGE_KEY, next);
      return next;
    });
  }, []);
  return [value, update];
}

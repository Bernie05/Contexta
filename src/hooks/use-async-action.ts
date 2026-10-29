"use client";

import { useCallback, useState } from "react";
import { errorMessage } from "@/lib/utils";

/**
 * Runs an async action with a busy flag and a user-facing error, the pattern every
 * dialog button needs. `run` resolves to true when the action succeeded.
 */
export function useAsyncAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (action: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  return { busy, error, run };
}

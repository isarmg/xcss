import { useCallback, useEffect, useRef, useState } from "react";

import type { AdministratorSession } from "@xcss/web/contracts";
import { isApiClientError } from "@xcss/web/http-client";

import type { AdministratorApiClient } from "./index.js";

export type AdministratorSessionState =
  | { phase: "loading"; session: null; error: null }
  | { phase: "anonymous"; session: null; error: null }
  | { phase: "anonymous_logout_unconfirmed"; session: null; error: unknown }
  | { phase: "authenticated"; session: AdministratorSession; error: null }
  | { phase: "error"; session: null; error: unknown };

export type AdministratorSessionController = AdministratorSessionState & {
  login(username: string, password: string): Promise<void>;
  logout(): Promise<void>;
  restore(): Promise<void>;
};

/** One current admin-only authentication state machine shared by React apps. */
export function useAdministratorSession(
  client: AdministratorApiClient,
): AdministratorSessionController {
  const activeClient = useRef(client);
  const stateGeneration = useRef(0);
  const logoutSequence = useRef(0);
  const logoutOutcome = useRef<{ client: AdministratorApiClient; sequence: number; confirmed: boolean; error?: unknown } | null>(null);
  activeClient.current = client;
  const [snapshot, setSnapshot] = useState<{ client: AdministratorApiClient; state: AdministratorSessionState }>(() => {
    const session = client.currentSession();
    return { client, state: session === null
      ? { phase: "loading", session: null, error: null }
      : { phase: "authenticated", session, error: null } };
  });
  const setState = useCallback((state: AdministratorSessionState) => {
    setSnapshot({ client, state });
  }, [client]);
  // Effects run after commit. Never render the previous client's authorization
  // in the intervening render when the application replaces its API context.
  const state: AdministratorSessionState = snapshot.client === client
    ? snapshot.state
    : { phase: "loading", session: null, error: null };

  const restore = useCallback(async () => {
    const generation = stateGeneration.current + 1;
    stateGeneration.current = generation;
    setState({ phase: "loading", session: null, error: null });
    try {
      const session = await client.restore();
      if (
        activeClient.current !== client ||
        stateGeneration.current !== generation
      ) return;
      setState({ phase: "authenticated", session, error: null });
    } catch (error) {
      if (
        activeClient.current !== client ||
        stateGeneration.current !== generation
      ) return;
      const current = client.currentSession();
      if (current !== null) {
        setState({ phase: "authenticated", session: current, error: null });
      } else if (
        isApiClientError(error) &&
        (error.status === 401 || error.code === "auth_operation_superseded")
      ) {
        setState({ phase: "anonymous", session: null, error: null });
      } else {
        setState({ phase: "error", session: null, error });
      }
    }
  }, [client, setState]);

  useEffect(() => {
    const unsubscribe = client.subscribe((session, error) => {
      if (activeClient.current !== client) return;
      stateGeneration.current += 1;
      if (session !== null || !error) logoutOutcome.current = null;
      setState(
        session === null
          ? error
            ? { phase: "error", session: null, error }
            : { phase: "anonymous", session: null, error: null }
          : { phase: "authenticated", session, error: null },
      );
    });
    void restore();
    return () => {
      unsubscribe();
      if (activeClient.current === client) stateGeneration.current += 1;
    };
  }, [client, restore, setState]);

  const login = useCallback(async (username: string, password: string) => {
    const generation = stateGeneration.current + 1;
    stateGeneration.current = generation;
    // Keep the sign-in form mounted while its submission is pending so it can
    // retain focus and render a failed login's safe error/Request ID.
    try {
      const session = await client.login(username, password);
      if (
        activeClient.current === client &&
        stateGeneration.current === generation
      ) {
        setState({ phase: "authenticated", session, error: null });
      }
    } catch (error) {
      if (
        activeClient.current === client &&
        stateGeneration.current === generation
      ) {
        const current = client.currentSession();
        setState(
          current === null
            ? logoutOutcome.current?.client === client && !logoutOutcome.current.confirmed
              ? { phase: "anonymous_logout_unconfirmed", session: null, error: logoutOutcome.current.error }
              : { phase: "anonymous", session: null, error: null }
            : { phase: "authenticated", session: current, error: null },
        );
      }
      throw error;
    }
  }, [client, setState]);

  const logout = useCallback(async () => {
    stateGeneration.current += 1;
    const sequence = ++logoutSequence.current;
    const recordOutcome = (confirmed: boolean, error?: unknown) => {
      const previous = logoutOutcome.current;
      if (activeClient.current === client && (previous === null || previous.client !== client || previous.sequence <= sequence)) {
        logoutOutcome.current = { client, sequence, confirmed, error };
      }
    };
    // logout synchronously publishes null; capture after that notification so
    // our own subscription does not make the operation's result stale.
    const pending = client.logout();
    const generation = stateGeneration.current;
    let failed = false;
    try {
      await pending;
      // Keep the operation result even if a queued login owns the UI now.
      // Sequence ordering prevents a delayed result replacing a newer outcome.
      recordOutcome(true);
    } catch (error) {
      failed = true;
      if (client.currentSession() === null) recordOutcome(false, error);
      if (activeClient.current === client && stateGeneration.current === generation && client.currentSession() === null) {
        setState({ phase: "anonymous_logout_unconfirmed", session: null, error });
      }
      throw error;
    } finally {
      if (
        activeClient.current === client &&
        stateGeneration.current === generation &&
        !failed
      ) {
        const current = client.currentSession();
        setState(
          current === null
            ? { phase: "anonymous", session: null, error: null }
            : { phase: "authenticated", session: current, error: null },
        );
      }
    }
  }, [client, setState]);

  return { ...state, login, logout, restore };
}

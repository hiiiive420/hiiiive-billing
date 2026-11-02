export type InFlightOperation<T> = { current: Promise<T> | null };

/** Reuse one pending autosave promise so concurrent triggers cannot create parallel first drafts. */
export function runSingleFlight<T>(state: InFlightOperation<T>, operation: () => Promise<T>): Promise<T> {
  if (state.current) return state.current;
  const flight = Promise.resolve().then(operation);
  state.current = flight;
  void flight.then(
    () => { if (state.current === flight) state.current = null; },
    () => { if (state.current === flight) state.current = null; },
  );
  return flight;
}

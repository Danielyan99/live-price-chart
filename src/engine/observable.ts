import { useSyncExternalStore } from "react";

/**
 * A tiny observable value for the low-frequency state React shows (source,
 * replay on/off, speed...). `set` skips notifying when nothing changed
 * (shallow compare), so per-tick data never causes a React render.
 */
export class Observable<T extends object> {
  private value: T;
  private readonly listeners = new Set<() => void>();

  constructor(initial: T) {
    this.value = initial;
  }

  get = (): T => this.value;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  set(patch: Partial<T>): void {
    let changed = false;
    for (const key of Object.keys(patch) as Array<keyof T>) {
      if (!Object.is(this.value[key], patch[key])) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    this.value = { ...this.value, ...patch };
    for (const l of this.listeners) l();
  }
}

export function useObservable<T extends object>(o: Observable<T>): T {
  return useSyncExternalStore(o.subscribe, o.get);
}

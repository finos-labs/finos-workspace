import { vi } from "vitest";

export type DeepPartial<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

type StoreHook<S> = <T>(selector: (state: S) => T) => T;

export function stubStoreState<S>(hook: StoreHook<S>, state: DeepPartial<NoInfer<S>>) {
  vi.mocked(hook).mockImplementation((selector) => selector(state as S));
}

export const partial = <T>(value: DeepPartial<NoInfer<T>>): T => value as T;

export const malformed = <T>(value: unknown): T => value as T;

export function required<T>(value: T | null | undefined, what = "value"): T {
  if (value === null || value === undefined) {
    throw new Error(`Expected the ${what} to be there`);
  }
  return value;
}

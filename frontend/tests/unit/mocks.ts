import { vi } from "vitest";

/** What a test names of a value, down to the fields that the code under test reads. */
export type DeepPartial<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

/** A store hook, which is read with a selector of the part of the state a component needs. */
type StoreHook<S> = <T>(selector: (state: S) => T) => T;

/**
 * Makes a mocked store hook hand its selectors a state of which a test names only a part,
 * which is all the component under test reads.
 */
export function stubStoreState<S>(hook: StoreHook<S>, state: DeepPartial<NoInfer<S>>) {
  vi.mocked(hook).mockImplementation((selector) => selector(state as S));
}

/** A value of which a test names only the fields that the code under test reads. */
export const partial = <T>(value: DeepPartial<NoInfer<T>>): T => value as T;

/** A value that is not what its type says, to see what the code under test does with it. */
export const malformed = <T>(value: unknown): T => value as T;

/** What a test knows to be there, which fails the test with what was missing when it is not. */
export function required<T>(value: T | null | undefined, what = "value"): T {
  if (value === null || value === undefined) {
    throw new Error(`Expected the ${what} to be there`);
  }
  return value;
}

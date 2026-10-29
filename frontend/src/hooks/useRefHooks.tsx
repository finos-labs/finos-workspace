import {
  type ForwardedRef,
  type MutableRefObject,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
} from "react";

type GenericFunc = (...args: never[]) => unknown;
type ObjectType<T> = { [K in keyof T]: T[K] };
type RecordRefsType<T> = MutableRefObject<ObjectType<T>>;

export function useRecordRef<T extends object>(initialValue: T): RecordRefsType<T> {
  const refs = useRef(initialValue);

  useEffect(() => {
    refs.current = initialValue;
  });

  return refs;
}

export function useCreateRef<T>(initialValue: T): MutableRefObject<T> {
  const ref = useRef(initialValue);

  useEffect(() => {
    ref.current = initialValue;
  });

  return ref;
}

export const useCallbackRef = <T extends GenericFunc>(callback: T | undefined): T => {
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  });

  return useMemo(
    () =>
      ((...args: Parameters<T>) =>
        (callbackRef.current as ((...args: Parameters<T>) => unknown) | undefined)?.(
          ...args,
        )) as T,
    [callbackRef],
  );
};

export function useComposeRefs<T>(...refs: (RefObject<T> | ForwardedRef<T> | null)[]) {
  return useMemo(() => {
    if (refs.every((ref) => ref == null)) {
      return null;
    }
    return (value: T | null) => {
      for (const ref of refs) {
        if (ref != null) {
          (ref as MutableRefObject<T | null>).current = value;
        }
      }
    };
  }, refs);
}

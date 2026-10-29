import { type Dispatch, useReducer, useRef } from "react";

export type FunctionAction<S> = (prevState: S) => S;
type SelectiveAction<S> = {
  [K in keyof S]?: S[K] | FunctionAction<S[K]>;
};

export type DispatchAction<S extends object> = SelectiveAction<S> | FunctionAction<S>;

export type StateReducer<S extends object> = (state: S, action: DispatchAction<S>) => S;
export type StateDispatch<S extends object> = Dispatch<DispatchAction<S>>;

export type UseStateReducer<S extends object> = [S, StateDispatch<S>];

export const reducerAction = <S extends object>(
  state: S,
  action: DispatchAction<S>,
): S => {
  if (typeof action === "function") {
    return action(state);
  }
  const next = { ...state };
  for (const key of Object.keys(action) as (keyof S)[]) {
    const value = action[key];
    next[key] =
      typeof value === "function"
        ? (value as FunctionAction<S[typeof key]>)(state[key])
        : (value as S[typeof key]);
  }
  return next;
};

export function useStateReducer<S extends object>(
  initialState: null | undefined | Partial<S>,
  initializer: (arg: S) => S,
): UseStateReducer<S>;
export function useStateReducer<S extends object>(
  initialState: S,
  initializer?: undefined,
): UseStateReducer<S>;
export function useStateReducer<S extends object, I>(
  initialState: I,
  initializer?: (arg: I & S) => S,
): UseStateReducer<S> {
  const initialStateRef = useRef(initialState);
  const reducer: StateReducer<S> = reducerAction;
  return useReducer(
    reducer,
    initialStateRef.current as I & S,
    initializer ?? ((arg) => arg),
  );
}

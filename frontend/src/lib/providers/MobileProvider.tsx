import isEqual from "lodash.isequal";
import type React from "react";
import { createContext, useContext, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { subscribeWithSelector } from "zustand/middleware";
import { createWithEqualityFn, useStoreWithEqualityFn } from "zustand/traditional";
import useIsMobile from "~/hooks/useIsMobile";

interface MobileProps {
  mobileNavigationDrawer: boolean;
  mobileCopilotDrawer: boolean;
  isMobile: boolean;
}

interface MobileState extends MobileProps {
  setMobileNavigationDrawer: (value: boolean) => void;
  setMobileCopilotDrawer: (value: boolean) => void;
  resetMobileDrawers: () => void;
  getMobileState: () => MobileProps;
  setIsMobile: (value: boolean) => void;
}

const createMobileStore = () => {
  return createWithEqualityFn<MobileState>()(
    subscribeWithSelector((set, get) => ({
      mobileNavigationDrawer: false,
      mobileCopilotDrawer: false,
      isMobile: false,
      setMobileNavigationDrawer: (value: boolean) =>
        set(() => ({ mobileNavigationDrawer: value })),
      setMobileCopilotDrawer: (value: boolean) =>
        set(() => ({ mobileCopilotDrawer: value })),
      resetMobileDrawers: () =>
        set(() => ({ mobileNavigationDrawer: false, mobileCopilotDrawer: false })),
      getMobileState: () => {
        const { mobileNavigationDrawer, mobileCopilotDrawer, isMobile } = get();
        return { mobileNavigationDrawer, mobileCopilotDrawer, isMobile };
      },
      setIsMobile: (value: boolean) => set(() => ({ isMobile: value })),
    })),
  );
};

type MobileStore = ReturnType<typeof createMobileStore>;
const MobileContext = createContext<MobileStore | null>(null);

export function useMobile(): MobileState;
export function useMobile<T>(
  selector: (store: MobileState) => T,
  equalityFn?: (a: T, b: T) => boolean,
): T;
export function useMobile<T>(
  selector?: (store: MobileState) => T,
  equalityFn: (a: T, b: T) => boolean = (prev, next) => isEqual(prev, next),
) {
  const store = useContext(MobileContext);

  if (!store) {
    throw new Error("useMobile must be used within a MobileProvider");
  }

  return useStoreWithEqualityFn(
    store,
    (state) => (selector ? selector(state) : state) as T,
    equalityFn,
  );
}

export const MobileProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [store] = useState(createMobileStore);

  const isMobile = useIsMobile();
  const pathname = useLocation()?.pathname;

  useEffect(() => {
    const state = store.getState();
    state.setIsMobile(isMobile);
    if (!isMobile) return;

    if (state.mobileNavigationDrawer || state.mobileCopilotDrawer)
      state.resetMobileDrawers();
  }, [pathname, isMobile, store]);

  useEffect(() => {
    if (!isMobile) return;
    const vv = window.visualViewport;
    if (!vv) return;

    const updateHeight = () => {
      document.documentElement.style.setProperty(
        "--mobile-viewport-height",
        `${vv.height}px`,
      );
    };

    updateHeight();
    vv.addEventListener("resize", updateHeight);
    return () => vv.removeEventListener("resize", updateHeight);
  }, [isMobile]);

  return <MobileContext.Provider value={store}>{children}</MobileContext.Provider>;
};

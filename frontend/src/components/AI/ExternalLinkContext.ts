import {
  createContext,
  type MouseEvent as ReactMouseEvent,
  useContext,
  useMemo,
} from "react";

type ExternalLinkContextValue = {
  openExternalLink: (url: string) => void;
};

export const ExternalLinkContext = createContext<ExternalLinkContextValue | null>(null);

function useExternalLink() {
  return useContext(ExternalLinkContext);
}

export function useExternalLinkAnchorProps(href?: string) {
  const external = useExternalLink();
  return useMemo(() => {
    if (!external || !href) return null;
    return {
      onClick: (e: ReactMouseEvent<HTMLAnchorElement>) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        external.openExternalLink(href);
      },
    };
  }, [external, href]);
}

import {
  createContext,
  type MouseEventHandler,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

const DATA_VISIBLE = "data-scrollspy-visible";
const DATA_ACTIVE = "data-scrollspy-active";

interface IScrollspyContext {
  activeId: string | null;
  setActiveId: (v: string | null) => void;
  dataAttrActive?: string;
}
const ScrollspyContext = createContext<IScrollspyContext | null>(null);

function useScrollspy() {
  const context = useContext(ScrollspyContext);
  if (!context)
    throw new Error("A Scrollspy component must be used inside ScrollspyRoot");
  return context;
}

interface ScrollspyRootProps {
  children: ReactNode;
  dataAttrActive?: string;
}

export function ScrollspyRoot(props: ScrollspyRootProps) {
  const { dataAttrActive = DATA_ACTIVE, children } = props;
  const [activeId, setActiveId] = useState<string | null>(null);
  return (
    <ScrollspyContext.Provider value={{ activeId, setActiveId, dataAttrActive }}>
      {children}
    </ScrollspyContext.Provider>
  );
}

interface SpyProps {
  children: ReactNode;
}

export function ScrollSpy(props: SpyProps) {
  const { children } = props;

  const ref = useRef<HTMLDivElement>(null);
  const [visibleElements, setVisibleElements] = useState<Element[]>([]);
  const { setActiveId } = useScrollspy();

  const [observer] = useState(
    new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const { id } = entry.target;
          if (entry.isIntersecting) {
            setVisibleElements((prev) => [...prev, entry.target]);
          } else {
            setVisibleElements((prev) => prev.filter((el) => el.id !== id));
          }
        });
      },
      { threshold: 0.2 },
    ),
  );

  function updateActiveId() {
    const visibleElements = Array.from(
      ref.current?.querySelectorAll(`[${DATA_VISIBLE}]`) || [],
    );
    const sorted = visibleElements.sort((a, b) => {
      return a.getBoundingClientRect().top - b.getBoundingClientRect().top;
    });

    const root = ref.current?.parentElement;
    if (!root) {
      setActiveId(sorted[0]?.id ?? null);
      return;
    }

    const paddingTop = Number.parseInt(
      getComputedStyle(root).getPropertyValue("padding-top"),
      10,
    );
    const isScrollable = root.scrollHeight > root.clientHeight;
    const isScrolledToTop = root.scrollTop <= paddingTop;
    const isScrolledToBottom = root.scrollHeight - root.scrollTop === root.clientHeight;

    if (sorted.length === 0) {
      setActiveId(null);
      return;
    }
    if (!isScrollable) {
      setActiveId(sorted[0].id);
      return;
    }
    if (isScrolledToTop) {
      setActiveId(sorted[0].id);
      return;
    }
    if (isScrolledToBottom) {
      setActiveId(sorted[sorted.length - 1].id);
      return;
    }

    if (sorted.length > 1) {
      const highestBB = sorted[0].getBoundingClientRect();
      const rootBB = root.getBoundingClientRect();
      const isHighestOut =
        highestBB.top < rootBB.top - 50 &&
        highestBB.bottom < rootBB.top + rootBB.height * 0.3;
      if (isHighestOut) {
        setActiveId(sorted[1].id);
        return;
      }
    }

    setActiveId(sorted[0].id);
  }

  useEffect(() => {
    const root = ref.current?.parentElement;
    if (root) {
      root.addEventListener("scroll", updateActiveId, { passive: true });
    }
    setTimeout(updateActiveId, 100);

    return () => {
      observer.disconnect();
      root?.removeEventListener("scroll", updateActiveId);
    };
  }, []);

  useEffect(() => {
    observer.disconnect();
    const items = ref.current?.querySelectorAll("[id]");
    items?.forEach((item) => {
      observer.observe(item);
    });
    updateActiveId();
  }, [ref]);

  useEffect(() => {
    document.querySelectorAll(`[${DATA_VISIBLE}]`).forEach((trigger) => {
      trigger.removeAttribute(DATA_VISIBLE);
    });
    visibleElements.forEach((el) => {
      el.setAttribute(DATA_VISIBLE, "");
    });
  }, [visibleElements]);

  return (
    <div ref={ref} style={{ display: "contents" }}>
      {children}
    </div>
  );
}

interface TriggerProps {
  children: ReactNode;
  id: string;
  className?: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
}

export function ScrollTrigger(props: TriggerProps) {
  const { children, onClick, id, ...rest } = props;
  const { activeId, setActiveId, dataAttrActive = DATA_ACTIVE } = useScrollspy();
  const ref = useRef<HTMLButtonElement>(null);

  function handleClick(e: ReactMouseEvent<HTMLButtonElement>) {
    const el = document.getElementById(id || "");
    if (el) {
      setTimeout(() => {
        setActiveId(id ?? null);
      }, 50);
    }
    onClick?.(e);
  }

  function updateActiveState() {
    if (activeId === id) {
      ref.current?.setAttribute(dataAttrActive, "");
    } else {
      ref.current?.removeAttribute(dataAttrActive);
    }
  }

  useEffect(updateActiveState, []);
  useEffect(updateActiveState, [id, activeId, dataAttrActive]);

  return (
    <a href={`#${id}`} className="contents">
      <button onClick={handleClick} ref={ref} {...rest}>
        {children}
      </button>
    </a>
  );
}

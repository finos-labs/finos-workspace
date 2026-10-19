import { createContext, type KeyboardEvent, type ReactNode, useContext, useId, useRef, useState } from "react";

interface TabsState {
  value: string;
  select: (value: string) => void;
  baseId: string;
}

const TabsContext = createContext<TabsState | null>(null);

function useTabs(): TabsState {
  const state = useContext(TabsContext);
  if (!state) throw new Error("Tabs components have to be used inside <Tabs>");
  return state;
}

interface TabsProps {
  defaultValue: string;
  onValueChange?: (value: string) => void;
  children: ReactNode;
}

export function Tabs({ defaultValue, onValueChange, children }: TabsProps) {
  const [value, setValue] = useState(defaultValue);
  const baseId = useId();
  const select = (next: string) => {
    setValue(next);
    onValueChange?.(next);
  };
  return (
    <TabsContext.Provider value={{ value, select, baseId }}>{children}</TabsContext.Provider>
  );
}

export function TabsList({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const tabs = [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])];
    const current = tabs.indexOf(document.activeElement as HTMLButtonElement);
    if (current < 0) return;
    let next = current;
    if (event.key === "ArrowRight") next = (current + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (current - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    tabs[next]?.focus();
    tabs[next]?.click();
  };
  return (
    <div ref={ref} role="tablist" className={className} onKeyDown={onKeyDown}>
      {children}
    </div>
  );
}

interface TabsTriggerProps {
  value: string;
  className?: string;
  children: ReactNode;
}

export function TabsTrigger({ value, className, children }: TabsTriggerProps) {
  const tabs = useTabs();
  const active = tabs.value === value;
  const tabId = `${tabs.baseId}-${value}-tab`;
  const panelId = `${tabs.baseId}-${value}-panel`;
  return (
    <button
      type="button"
      role="tab"
      id={tabId}
      aria-selected={active}
      aria-controls={active ? panelId : undefined}
      tabIndex={active ? 0 : -1}
      data-state={active ? "active" : "inactive"}
      onClick={() => tabs.select(value)}
      className={`border-b-2 border-transparent text-general-label hover:text-general-label-hover data-[state=active]:border-link-color data-[state=active]:text-link-color ${className ?? ""}`}
    >
      {children}
    </button>
  );
}

export function TabsContent({ value, children }: { value: string; children: ReactNode }) {
  const tabs = useTabs();
  return tabs.value === value ? (
    <div
      role="tabpanel"
      id={`${tabs.baseId}-${value}-panel`}
      aria-labelledby={`${tabs.baseId}-${value}-tab`}
      className="space-y-4"
    >
      {children}
    </div>
  ) : null;
}

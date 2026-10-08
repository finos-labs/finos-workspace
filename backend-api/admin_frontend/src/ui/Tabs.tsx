import { createContext, type ReactNode, useContext, useState } from "react";

interface TabsState {
  value: string;
  select: (value: string) => void;
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
  const select = (next: string) => {
    setValue(next);
    onValueChange?.(next);
  };
  return <TabsContext.Provider value={{ value, select }}>{children}</TabsContext.Provider>;
}

export function TabsList({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div role="tablist" className={className}>
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
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
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
    <div role="tabpanel" className="space-y-4">
      {children}
    </div>
  ) : null;
}

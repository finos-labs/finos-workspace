import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cva } from "class-variance-authority";
import React from "react";
import { cn } from "../utils";

interface TabsContextValue {
  variant?: "default" | "filled" | "filled_secondary";
}

const TabsContext = React.createContext<TabsContextValue>({
  variant: "default",
});

interface TabsProps
  extends React.ComponentPropsWithoutRef<typeof TabsPrimitive.Root>,
    TabsContextValue {}

export const Tabs = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Root>,
  TabsProps
>(({ className, variant, ...props }, ref) => (
  <TabsContext.Provider value={{ variant }}>
    <TabsPrimitive.Root ref={ref} className={cn(className)} {...props} />
  </TabsContext.Provider>
));
Tabs.displayName = TabsPrimitive.Root.displayName;

const TabListVariants = cva(["flex"], {
  variants: {
    variant: {
      default: "body-sm-medium gap-6",
      filled: "body-xs-medium gap-1",
      filled_secondary: "body-xs-medium gap-2 bg-tab-group-bg rounded p-1",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

interface TabsListProps
  extends React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> {}
export const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  TabsListProps
>(({ className, ...props }, ref) => {
  const { variant } = React.useContext(TabsContext);
  return (
    <TabsPrimitive.List
      ref={ref}
      className={cn(TabListVariants({ variant }), className)}
      {...props}
    />
  );
});
TabsList.displayName = TabsPrimitive.List.displayName;

const TabTriggerVariants = cva(["transition"], {
  variants: {
    variant: {
      default: [
        "border-transparent border-b",
        "disabled:pointer-events-none disabled:opacity-50",
        "text-ds-text-body",
        "hover:text-general-label-hover",
        "data-[state=active]:border-current data-[state=active]:text-tab-action-active",
        "[&.active]:border-current [&.active]:text-tab-action-active",
      ],
      filled: [
        "text-nowrap rounded-t-sm px-2.5",
        "disabled:pointer-events-none disabled:opacity-50",
        "bg-tab-bg-secondary text-ds-text-caption",
        "hover:text-general-label",
        "data-[state=active]:bg-tab-filled-primary-bg-active data-[state=active]:text-tab-filled-primary-text-active",
        "[&.active]:bg-tab-filled-primary-bg-active [&.active]:text-tab-filled-primary-text-active",
      ],
      filled_secondary: [
        "whitespace-nowrap rounded truncate",
        "px-2.5 py-[7px]",
        "w-full",
        "data-[state=active]:font-medium",
        "text-tab-filled-secondary-text",
        "data-[state=active]:text-tab-action-active data-[state=active]:bg-tab-bg-primary",
        "hover:data-[state=inactive]:bg-tab-filled-secondary-bg-hover",
      ],
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

interface TabsTriggerProps
  extends React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> {}
export const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  TabsTriggerProps
>(({ className, ...props }, ref) => {
  const { variant } = React.useContext(TabsContext);
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(TabTriggerVariants({ variant }), className)}
      {...props}
    />
  );
});
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

interface TabsContentProps
  extends React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content> {}
export const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  TabsContentProps
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content ref={ref} className={className} {...props} />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

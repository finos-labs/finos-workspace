/// <reference types="vite/client" />

interface WindowEventMap {
  copilotCommand: CustomEvent<{ command?: string | ((current: string) => string) }>;
  copilotSubmit: CustomEvent<
    import("~/components/AI/hooks/useStreamResponse").CopilotSubmitParams | undefined
  >;
  copilotStopSubmit: Event;
}

declare module "*.md" {
  export const markdown: string;
}

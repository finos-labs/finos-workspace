/// <reference types="vite/client" />

interface WindowEventMap {
  /** Sets the question in the Copilot prompt, from a string or from the current text. */
  copilotCommand: CustomEvent<{ command?: string | ((current: string) => string) }>;
  /** Submits a question to the Copilot, optionally with a canned response. */
  copilotSubmit: CustomEvent<
    import("~/components/AI/hooks/useStreamResponse").CopilotSubmitParams | undefined
  >;
  copilotStopSubmit: Event;
}

// The vite markdown plugin exposes the source of a .md file as `markdown`.
declare module "*.md" {
  export const markdown: string;
}

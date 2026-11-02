import { memo, type ReactNode, useMemo } from "react";
import { useCopilotAvailable } from "./hooks/useCopilotAvailable";
import { useHandleStreaming } from "./hooks/useStreamResponse";

function CopilotWrapper({ children }: { children: ReactNode }) {
  useHandleStreaming();
  const copilotAvailable = useCopilotAvailable();
  const childrenMemo = useMemo(() => children, [children]);
  if (!copilotAvailable) return null;

  return (
    <div
      key="copilot-wrapper"
      className="flex flex-col h-full bg-white dark:bg-dark-900 copilot text-xs max-h-screen overflow-hidden"
    >
      {childrenMemo}
    </div>
  );
}

export default memo(CopilotWrapper);

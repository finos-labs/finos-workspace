import { useMemo } from "react";
import type { Message, MessageGroup } from "~/lib/state/copilot";
import { CopilotAIMessage, CopilotHumanMessage, CopilotSystemMessage } from ".";

type CopilotMessageProps = {
  message: Message;
  showIcon: boolean;
  currentGroupId?: string;
  allGroups?: MessageGroup[];
  groupIndex?: number;
  isPartOfStepByStepGroup?: boolean;
};

export default function CopilotMessage(props: CopilotMessageProps) {
  const {
    message,
    showIcon,
    currentGroupId,
    allGroups,
    groupIndex,
    isPartOfStepByStepGroup,
  } = props;

  const messageContent = useMemo(() => {
    if (message.role === "human") {
      return <CopilotHumanMessage message={message} />;
    }
    if (message.role === "system") {
      return (
        <CopilotSystemMessage
          message={message}
          showIcon={showIcon}
          currentGroupId={currentGroupId}
          isPartOfStepByStepGroup={isPartOfStepByStepGroup}
        />
      );
    }
    if (message.role === "ai") {
      return (
        <CopilotAIMessage
          message={message}
          allGroups={allGroups}
          groupIndex={groupIndex}
        />
      );
    }
    // If message type is not recognized, do not render anything
    return null;
  }, [
    message,
    showIcon,
    currentGroupId,
    allGroups,
    groupIndex,
    isPartOfStepByStepGroup,
  ]);

  return useMemo(
    () => (
      <>
        <div className="_message-content">
          {messageContent && (
            <div className="flex flex-col gap-3.5 items-start justify-start relative text-xs">
              {messageContent}
            </div>
          )}
        </div>
      </>
    ),
    [messageContent],
  );
}

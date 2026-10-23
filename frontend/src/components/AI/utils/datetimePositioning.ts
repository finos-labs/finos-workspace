import type { AIMessage, MessageGroup } from "~/lib/state/copilot";

export interface DatetimePositionStrategy {
  shouldShowDatetime: boolean;
  targetGroupId: string | null;
  timestamp: number;
  reason: string;
}

export function getDatetimePositionStrategy(
  message: AIMessage,
  allGroups: MessageGroup[],
  currentGroupIndex: number,
): DatetimePositionStrategy {
  const stepByStepGroup = findPrecedingStepByStepReasoning(
    allGroups,
    currentGroupIndex,
  );

  if (stepByStepGroup) {
    return {
      shouldShowDatetime: true,
      targetGroupId: `group-${stepByStepGroup.index}`,
      timestamp: stepByStepGroup.timestamp,
      reason: message.isCancelled
        ? "cancelled_message_above_step_by_step"
        : "completed_message_above_step_by_step",
    };
  }

  if (message.content) {
    return {
      shouldShowDatetime: true,
      targetGroupId: `group-${currentGroupIndex}`,
      timestamp: message.timestamp,
      reason: "normal_completion_above_ai_message",
    };
  }

  return {
    shouldShowDatetime: false,
    targetGroupId: null,
    timestamp: message.timestamp,
    reason: "no_datetime_needed",
  };
}

function findPrecedingStepByStepReasoning(
  allGroups: MessageGroup[],
  currentGroupIndex: number,
): { index: number; timestamp: number } | null {
  const maxLookback = 2;
  const searchStart = Math.max(0, currentGroupIndex - maxLookback);

  for (let i = currentGroupIndex - 1; i >= searchStart; i--) {
    const candidateGroup = allGroups[i];

    if (
      candidateGroup &&
      candidateGroup.role === "system" &&
      (candidateGroup.groupTitle === "Step-by-step reasoning" ||
        candidateGroup.groupTitle?.includes("Step-by-step") ||
        (candidateGroup.groupTitle && candidateGroup.groupTitle.length > 0)) &&
      candidateGroup.messages.length > 0
    ) {
      const hasIntermediateAI = allGroups
        .slice(i + 1, currentGroupIndex)
        .some((group) => group.role === "ai");

      if (hasIntermediateAI) {
        continue;
      }

      return {
        index: i,
        timestamp: candidateGroup.messages[0].timestamp,
      };
    }
  }

  return null;
}

export function getEnhancedDatetimePositionStrategy(
  message: AIMessage,
  allGroups: MessageGroup[],
  currentGroupIndex: number,
  isStreaming = false,
): DatetimePositionStrategy {
  const baseStrategy = getDatetimePositionStrategy(
    message,
    allGroups,
    currentGroupIndex,
  );

  if (isStreaming) {
    return {
      ...baseStrategy,
      reason: `${baseStrategy.reason}_during_streaming`,
    };
  }

  if (!message.content || message.content === null) {
    if (
      baseStrategy.shouldShowDatetime &&
      baseStrategy.reason.includes("step_by_step")
    ) {
      return baseStrategy;
    }

    const targetId = `group-${currentGroupIndex}`;
    return {
      shouldShowDatetime: true,
      targetGroupId: targetId,
      timestamp: message.timestamp,
      reason: "empty_content_above_message",
    };
  }

  if (hasOnlyArtifacts(message.content) && !message.isCancelled) {
    const stepByStepGroup = findPrecedingStepByStepReasoning(
      allGroups,
      currentGroupIndex,
    );

    if (stepByStepGroup) {
      return {
        shouldShowDatetime: true,
        targetGroupId: `group-${stepByStepGroup.index}`,
        timestamp: stepByStepGroup.timestamp,
        reason: "artifact_only_above_reasoning",
      };
    }
  }

  return baseStrategy;
}

function hasOnlyArtifacts(content: string): boolean {
  if (!content) return false;

  const withoutArtifacts = content
    .replace(/<artifact[^>]*>.*?<\/artifact>/gs, "")
    .replace(/<artifact[^>]*\/>/g, "")
    .trim();

  return withoutArtifacts.length < 10;
}

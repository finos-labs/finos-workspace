import { memo, useMemo } from "react";
import { useMcpToolSuggestions } from "~/components/AI/hooks/useMcpToolSuggestions";
import { useSkillSuggestions } from "~/components/AI/hooks/useSkillSuggestions";
import Tooltip from "~/components/Tooltip";
import type { Mention } from "~/lib/state/copilot";
import { cn, isValidUrl } from "~/lib/utils";
import { useMentions } from "./hooks/useMentions";
import { findUnresolvedMentions } from "./utils/unresolvedMentions";

type TextStyleProps = {
  content: string;
  className?: string;
  overlay?: boolean;
  singleLine?: boolean;
};

function getMentionsMap(mentions: Mention[]) {
  return mentions.reduce<Record<string, Mention>>((acc, mention) => {
    const key = `${mention.trigger}${mention.name}`;
    acc[key] = mention;
    return acc;
  }, {});
}

function getSplitLines(
  renderedContent: string,
  mentionsMap: Record<string, Mention>,
  skillSlugs: Set<string>,
  mcpToolPatterns: Set<string>,
  unresolvedTokens: string[],
) {
  const lines = renderedContent.split("\n");
  return lines.map((line) => {
    try {
      let parts = [line];
      const mentionKeys = Object.keys(mentionsMap);

      const skillPatterns = Array.from(skillSlugs);
      const mcpPatterns = Array.from(mcpToolPatterns);
      const allPatterns = [
        ...mentionKeys,
        ...skillPatterns,
        ...mcpPatterns,
        ...unresolvedTokens,
      ].sort((a, b) => b.length - a.length);

      const expression =
        allPatterns.length > 0
          ? `(${allPatterns.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")}|\\s+)`
          : "(\\s+)";
      const regex = new RegExp(expression, "g");
      parts = line.split(regex);
      const result = parts.filter((p) => p !== "");
      return result;
    } catch (error) {
      return [line];
    }
  });
}

function TextStyle(props: TextStyleProps) {
  const { content, className = "", overlay = false, singleLine = false } = props;
  const { processMentions } = useMentions();
  const { result: renderedContent, mentions } = useMemo(
    () => processMentions(content),
    [content, processMentions],
  );

  const { skillOptions } = useSkillSuggestions();
  const { mcpToolOptions } = useMcpToolSuggestions();

  const skillSlugs = useMemo(
    () => new Set(skillOptions.map((s) => s.slashText)),
    [skillOptions],
  );
  const mcpToolPatterns = useMemo(
    () => new Set(mcpToolOptions.map((t) => t.slashText)),
    [mcpToolOptions],
  );

  const unresolvedMentions = useMemo(
    () => findUnresolvedMentions(renderedContent),
    [renderedContent],
  );

  const contentMemo = useMemo(() => {
    const mentionsMap = getMentionsMap(mentions);
    const splitLines = getSplitLines(
      renderedContent,
      mentionsMap,
      skillSlugs,
      mcpToolPatterns,
      Array.from(unresolvedMentions.keys()),
    );

    const lines = singleLine
      ? [
          splitLines.reduce<string[]>((acc, line, i) => {
            if (i > 0) acc.push(" ");
            acc.push(...line);
            return acc;
          }, []),
        ]
      : splitLines;

    const OuterTag = singleLine ? "span" : "div";
    const InnerTag = singleLine ? "span" : "div";

    return (
      <OuterTag className={className}>
        {lines.map((line, lineIndex) => (
          <InnerTag key={lineIndex}>
            {line.map((part, index) => {
              const key = `${lineIndex}-${part}-${index}`;
              const mention = mentionsMap[part];
              const isSlashCommand = skillSlugs.has(part) || mcpToolPatterns.has(part);

              if (isValidUrl(part)) {
                if (singleLine) {
                  return (
                    <span key={key} className="text-alert-informative">
                      {part}
                    </span>
                  );
                }
                return (
                  <span
                    key={key}
                    className="relative z-40 text-alert-informative cursor-pointer pointer-events-auto"
                    onClick={() => {
                      const url = part.replace(/[?.]$/, "");
                      const formattedUrl = url.startsWith("http")
                        ? url
                        : `https://${url}`;
                      window.open(formattedUrl, "_blank", "noopener,noreferrer");
                    }}
                  >
                    {part}
                  </span>
                );
              }

              const unresolvedLabel = unresolvedMentions.get(part);
              if (unresolvedLabel) {
                return (
                  <Tooltip
                    key={key}
                    hide={overlay}
                    message="This reference can't be resolved here — it may have been removed, or it belongs to another dashboard."
                  >
                    <span
                      className={cn(
                        "rounded-full py-[0.25em]",
                        "bg-general-bg-secondary text-ds-text-caption",
                        overlay
                          ? "px-[0.3em] -mx-[0.3em]"
                          : "inline-block max-w-full truncate align-middle px-1 border border-dashed border-general-border-primary",
                      )}
                    >
                      {overlay ? part : unresolvedLabel}
                    </span>
                  </Tooltip>
                );
              }

              if (mention || isSlashCommand) {
                const isWeb = mention?.group === "web";
                return (
                  <span
                    key={key}
                    title={overlay ? undefined : part}
                    className={cn(
                      "rounded-full py-[0.25em]",
                      isWeb ? "bg-copilot-mention-web-bg" : "bg-copilot-mention-bg",
                      isWeb
                        ? "text-copilot-mention-web-label"
                        : "text-copilot-mention-label",
                      overlay
                        ? "px-[0.3em] -mx-[0.3em]"
                        : "inline-block max-w-full truncate align-middle px-1",
                    )}
                  >
                    {part}
                  </span>
                );
              }

              return <span key={key}>{part}</span>;
            })}
            {!singleLine && lineIndex < lines.length - 1 && <br />}
          </InnerTag>
        ))}
      </OuterTag>
    );
  }, [
    renderedContent,
    className,
    mentions,
    skillSlugs,
    mcpToolPatterns,
    unresolvedMentions,
    overlay,
    singleLine,
  ]);

  return contentMemo;
}

export default memo(TextStyle);

import type { Chat } from "~/lib/state/copilot";
import { slugify } from "~/lib/utils/utils";

export function chatToMarkdown(chat: Chat): string {
  const lines: string[] = [`# ${chat.label?.trim() || "Untitled chat"}`];

  for (const message of chat.messages) {
    if (message.role === "human") {
      appendTurn(lines, "You", message.content);
    } else if (message.role === "ai") {
      try {
        const parsed = JSON.parse(message.content);
        if (parsed.function) continue;
      } catch {}
      appendTurn(lines, "AI", message.content);
    }
  }

  return `${lines.join("\n")}\n`;
}

function appendTurn(lines: string[], speaker: string, content: string): void {
  const trimmed = content?.trim();
  if (!trimmed) return;
  lines.push("", `**${speaker}:**`, "", trimmed);
}

export function downloadChatAsMarkdown(chat: Chat): void {
  const markdown = chatToMarkdown(chat);
  const blob = new Blob([markdown], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${slugify(chat.label) || "chat"}.md`;
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

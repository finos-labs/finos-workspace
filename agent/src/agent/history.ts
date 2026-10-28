import type { Message } from "../protocol/types.ts";
import { stripPlaceholderTags } from "../protocol/events.ts";

export interface TranscriptEntry {
  number: number;
  role: "user" | "assistant";
  text: string;
  source: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseJsonEnvelope(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function isInternalProtocolEnvelope(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.length > 0 && value.every(isInternalProtocolEnvelope);
  }
  if (!isRecord(value)) return false;

  if (typeof value.function === "string" && isRecord(value.input_arguments)) {
    return true;
  }

  if (typeof value.event === "string" && value.event.startsWith("copilot") && isRecord(value.data)) {
    return true;
  }

  return false;
}

export function sanitizeAssistantContent(content: string): string | null {
  const parsed = parseJsonEnvelope(content);
  if (isInternalProtocolEnvelope(parsed)) return null;

  const cleaned = stripPlaceholderTags(content).trim();
  return cleaned.length > 0 ? cleaned : null;
}

export function currentTurnStart(messages: Message[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "human") return i;
  }
  return 0;
}

export function transcriptOf(messages: Message[]): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  messages.forEach((message, source) => {
    if (message.role === "human" && typeof message.content === "string") {
      entries.push({ number: entries.length + 1, role: "user", text: message.content, source });
    } else if (message.role === "ai" && typeof message.content === "string") {
      const text = sanitizeAssistantContent(message.content);
      if (text) entries.push({ number: entries.length + 1, role: "assistant", text, source });
    }
  });
  return entries;
}

export function earlierEntries(messages: Message[]): TranscriptEntry[] {
  const start = currentTurnStart(messages);
  return transcriptOf(messages).filter((entry) => entry.source < start);
}

const NOTE_QUESTIONS = 8;
const NOTE_QUESTION_CHARS = 120;

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

export function conversationNote(earlier: TranscriptEntry[]): string | null {
  if (earlier.length === 0) return null;
  const questions = earlier
    .filter((entry) => entry.role === "user")
    .slice(-NOTE_QUESTIONS)
    .map((entry) => `#${entry.number} "${oneLine(entry.text, NOTE_QUESTION_CHARS)}"`);
  return [
    `[Conversation memory] This conversation has ${earlier.length} earlier messages (numbered 1-${earlier.length}) that are not shown to you: you see only the current question and what has happened in this turn.`,
    questions.length > 0 ? `What the user asked last, before this question:\n${questions.join("\n")}` : null,
    "If the question refers to anything you cannot see (it, that, again, the previous answer, \"as before\", a name, a number or a decision from earlier), read the earlier messages with recall_conversation before you answer. Do not guess what they said. If the question stands on its own, just answer it.",
  ]
    .filter(Boolean)
    .join("\n");
}

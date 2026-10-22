/**
 * What the agent is told of a conversation.
 *
 * The Workspace sends the whole chat with every request. The model is not given it: it is served what
 * the current turn needs (the question and what has happened since in this turn) and one note that says
 * the earlier messages exist, how many they are, and what the user last asked. Anything else of the
 * conversation it fetches itself with `recall_conversation`. Serving the whole chat every time costs more
 * with every message (a long chat pays for all of it on each question, and counts it against the user's
 * daily tokens) and ends, in a long enough chat, in a request the model refuses.
 */

import type { Message } from "../protocol/types.ts";
import { stripPlaceholderTags } from "../protocol/events.ts";

/** A message of the conversation as a person would read it: what the user wrote, what the agent answered. */
export interface TranscriptEntry {
  /** Position in the conversation, counting from 1. What `recall_conversation` and the note call it. */
  number: number;
  role: "user" | "assistant";
  text: string;
  /** Position in the request's `messages`. */
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

/** What an assistant message says to a reader: null for a protocol envelope (a tool call) or an empty one. */
export function sanitizeAssistantContent(content: string): string | null {
  const parsed = parseJsonEnvelope(content);
  if (isInternalProtocolEnvelope(parsed)) return null;

  const cleaned = stripPlaceholderTags(content).trim();
  return cleaned.length > 0 ? cleaned : null;
}

/** Where the current turn starts: at the user's last message, or at the start when there is none. */
export function currentTurnStart(messages: Message[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "human") return i;
  }
  return 0;
}

/** The conversation as text, numbered. Tool round trips and protocol envelopes are not part of it. */
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

/** The messages from before the current turn: the ones the model is not shown. */
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

/**
 * The only thing the model is told of what came before: that it exists, and what the user last asked, so
 * that it can tell whether the question needs it. Null when this is the first turn.
 */
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

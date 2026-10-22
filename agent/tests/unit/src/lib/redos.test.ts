/**
 * Text that is made to be slow for a pattern. A model (talked into it by a page), a provider's error (which
 * repeats what the user sent) and the user themselves can all put text into these functions, and each
 * pattern that takes time that grows with the square of the text blocks the whole agent while it runs:
 * every query, the health check and the metrics wait for it.
 */

import { describe, it, expect } from "bun:test";
import { redactString, redactValue } from "../../../../src/lib/redact";
import { pagesNamedIn } from "../../../../src/protocol/citations";
import { stripPlaceholderTags, parseSuggestions } from "../../../../src/protocol/events";
import { sanitizeAssistantContent } from "../../../../src/agent/history";
import { makeTextSink } from "../../../../src/agent/text-sink";
import { clipForModel } from "../../../../src/agent/clip";

const BUDGET_MS = 1000;
const SIZE = 1_000_000;

/** Pieces that a pattern may start to match again and again. */
const RUNS = [" ", "\n", ":", " :", "\t"];
const UNITS = [
  "a.", "a@", "a@b.", "a.b@", ".", "@", "-", "_", " ", "\n", "\t ", "0", "1 ", "1-", "1,", "1 and ",
  "page ", "page", "pages ", "pp.", "p. ", "page 1-", "page 1, ", "page :", "p ",
  "<", "<artifact ", "<artifact_id:", "<citation", "<|start_artifact|>", "<|end_artifact|>", "<img ", "<suggestions", "<suggestion>",
  "suggestion", "suggestions>", "```", "```mermaid\n", "![", "](", "![a](data:image/png;base64,",
  "Bearer ", "Bearer", "eyJabcde.", "eyJabcde.abcde.", "sk-", "nvapi-", "xoxb-", "data:a;base64,", "data:image/png;base64,",
  "?token=", "&key=", "http://", "https://a.b/", "[", "]", "(", ")", "\\", "\"", "'", "{", "}", "&", ";", "=", "/", "+",
];

function timed(label: string, run: () => unknown): void {
  const start = performance.now();
  run();
  const took = performance.now() - start;
  if (took > BUDGET_MS) throw new Error(`${label} took ${Math.round(took)} ms`);
}

describe("a long run after a word that starts a pattern", () => {
  for (const word of ["page", "pages", "p.", "pp", "Bearer", "data:a;base64,", "<artifact", "![a]", "```", "<|start_artifact|>", "suggestion"]) {
    for (const run of RUNS) {
      it(`${JSON.stringify(word)} then ${JSON.stringify(run)} repeated`, () => {
        const text = `${word}${run.repeat(200_000)}x`;
        timed("redactString", () => redactString(text));
        timed("pagesNamedIn", () => pagesNamedIn(text));
        timed("stripPlaceholderTags", () => stripPlaceholderTags(text));
        timed("parseSuggestions", () => parseSuggestions(text));
        const many = `${word}${run.repeat(20)}`.repeat(20_000);
        timed("redactString (many)", () => redactString(many));
        timed("pagesNamedIn (many)", () => pagesNamedIn(many));
        timed("stripPlaceholderTags (many)", () => stripPlaceholderTags(many));
      });
    }
  }
});

describe("text made to be slow", () => {
  for (const unit of UNITS) {
    const text = unit.repeat(Math.ceil(SIZE / unit.length));

    it(`redactString on ${JSON.stringify(unit)} repeated`, () => timed("redactString", () => redactString(text)));
    it(`redactValue on ${JSON.stringify(unit)} repeated`, () => timed("redactValue", () => redactValue({ message: text, nested: [text] })));
    it(`pagesNamedIn on ${JSON.stringify(unit)} repeated`, () => timed("pagesNamedIn", () => pagesNamedIn(text)));
    it(`stripPlaceholderTags on ${JSON.stringify(unit)} repeated`, () => timed("stripPlaceholderTags", () => stripPlaceholderTags(text)));
    it(`parseSuggestions on ${JSON.stringify(unit)} repeated`, () => timed("parseSuggestions", () => parseSuggestions(text)));
    it(`sanitizeAssistantContent on ${JSON.stringify(unit)} repeated`, () => timed("sanitizeAssistantContent", () => sanitizeAssistantContent(text)));
    it(`clipForModel on ${JSON.stringify(unit)} repeated`, () => timed("clipForModel", () => clipForModel(text, 20_000)));
    it(`the text sink, given ${JSON.stringify(unit)} repeated in one delta and in small ones`, () => {
      timed("sink (one delta)", () => {
        const sink = makeTextSink({ deferredAnswerArtifactEvents: [], onArtifactEmitted: () => {} });
        sink.pushDelta(text);
        sink.flushTail();
        sink.takeSuggestions();
      });
      timed("sink (small deltas)", () => {
        const sink = makeTextSink({ deferredAnswerArtifactEvents: [], onArtifactEmitted: () => {} });
        const small = text.slice(0, 300_000);
        for (let i = 0; i < small.length; i += 7) sink.pushDelta(small.slice(i, i + 7));
        sink.flushTail();
        sink.takeSuggestions();
      });
    });
  }
});

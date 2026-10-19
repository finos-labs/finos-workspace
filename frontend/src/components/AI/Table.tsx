import clsx from "clsx";
import Markdown from "markdown-to-jsx";
import type { ReactNode } from "react";
import { isValidUrl } from "~/lib/utils";

import "./tritanopia-dark.css";
import {
  CodeComponent,
  inertImageOverride,
  PreCodeComponent,
  renderRule,
} from "./MarkdownOverrides";

export default function Table({
  content,
  disableAutoLink,
}: {
  content: Record<string, unknown>;
  disableAutoLink?: boolean;
}) {
  return (
    <table className="w-full table-auto rounded">
      <tbody>
        {Object.entries(content).map(([key, value], index) => {
          const newJson = isValidJSON(value);
          if (newJson) {
            return (
              <tr
                key={`${key}-${index}-row`}
                className="border-b border-light-300 dark:border-dark-600"
              >
                <td className="font-bold px-2 py-2">{key}</td>
                <td className="px-2 py-2">
                  <table
                    className="w-full table-auto rounded"
                    key={`${key}-${index}-table`}
                  >
                    <tbody>{jsonTable(newJson, disableAutoLink)}</tbody>
                  </table>
                </td>
              </tr>
            );
          }

          return (
            <tr
              key={`${key}-${index}-row`}
              className={clsx({
                "border-b border-light-300 dark:border-dark-600 whitespace-nowrap":
                  index < Object.entries(content).length - 1,
              })}
            >
              <td className="w-[20%] font-bold px-2 py-2">{key}</td>
              <td className="px-2 py-2">
                {formatValue(
                  value == null ? undefined : String(value),
                  disableAutoLink,
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

type JsonObject = Record<string, unknown>;

function isValidJSON(json: unknown): JsonObject | false {
  if (typeof json === "string") {
    try {
      json = JSON.parse(json);
    } catch (e) {
      return false;
    }
  }

  if (typeof json === "object" && json !== null) {
    return json as JsonObject;
  }

  return false;
}

function jsonTable(json: JsonObject, disableAutoLink = false, depth = 0): ReactNode[] {
  return Object.entries(json)
    .flatMap(([key, value], index) => {
      const newJson = isValidJSON(value);
      if (newJson) return jsonTable(newJson, disableAutoLink, depth + 1);

      if (typeof value === "string" || typeof value === "number") {
        return (
          <tr
            key={`${key}-${index}-${depth}`}
            className={clsx({
              "border-b border-light-300 dark:border-dark-600":
                index < Object.entries(json).length - 1,
            })}
          >
            <td className="font-bold px-2 py-2">{key}</td>
            <td className="px-2 py-2 break-words line-clamp-2">
              {formatValue(value?.toString(), disableAutoLink, depth)}
            </td>
          </tr>
        );
      }

      return null;
    })
    .filter((row) => row !== null);
}

function formatValue(text = "", disableAutoLink = false, depth = 0) {
  // Check if text contains markdown code blocks
  if (text.includes("```")) {
    return (
      <Markdown
        options={{
          renderRule,
          disableParsingRawHTML: true,
          overrides: {
            ...inertImageOverride,
            a: {
              component: ({ children }: { children: ReactNode }) => (
                <span className="text-inherit">{children}</span>
              ),
            },
            code: { component: CodeComponent },
            pre: { component: PreCodeComponent },
          },
        }}
      >
        {text}
      </Markdown>
    );
  }

  if (disableAutoLink) return text;
  try {
    return text
      .toString()
      .split(" ")
      .map((word, index) =>
        isValidUrl(word) ? (
          <span key={`${index}-${depth}-value`}>
            <a
              href={word.replace(/[?.]$/, "")} // Extract the link and remove punctuation
              className="rounded py-[0.5px] text-alert-informative"
              target="_blank"
              rel="noopener noreferrer"
            >
              {word.replace(/[?.]$/, "")}
            </a>
            {/[?.]$/.test(word) && (
              <span className="pointer-events-none">{word.slice(-1)}</span>
            )}{" "}
          </span>
        ) : (
          <span key={`${index}-${depth}-value`}>{word} </span>
        ),
      );
  } catch (e) {
    return text;
  }
}

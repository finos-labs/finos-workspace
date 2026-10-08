import type { ReactNode } from "react";
import { toast } from "sonner";
import { cn } from "~/components/ds/utils/cn";
import { docsUrl } from "~/lib/docsUrl";
import type { Source } from "~/lib/state/backendConnector";
import { useInvalidItemsStore } from "~/lib/state/invalidItems";
import { type InvalidItem, summarizeInvalidItems } from "~/lib/utils/invalidItems";
import {
  formatUnrecognizedKeysAsText,
  type UnrecognizedKeysReport,
} from "~/utils/zodForms";

export function formatZodErrorMessage(
  errorMessage: string,
  className?: string,
): ReactNode {
  if (typeof errorMessage !== "string" || !errorMessage) return null;

  return errorMessage.split("\n\n").map((line, idx) => {
    const [errorInfo, ...errors] = line.split("\n").map((l) => {
      const regex = /`([^`]+)`/g;
      const regex2 = /\[([^\]]+)\]/g;
      return l.split(regex).map((part, idx) => {
        if (!part) return null;
        if (idx % 2 === 1) {
          return (
            <code
              key={idx}
              className="font-semibold text-2xs px-0.5 bg-light-200 dark:bg-dark-700"
            >
              {part}
            </code>
          );
        }
        return part.split(regex2).map((p, idx2) => {
          if (idx2 % 2 === 1) {
            p = `[${p}]`;
            return (
              <span
                key={idx2}
                className="text-brand-main dark:text-brand-lighter font-semibold"
              >
                {p}
              </span>
            );
          }
          return p;
        });
      });
    });

    const filteredInfo = errorInfo.filter((part) => part !== null);

    return (
      <div key={idx} className="flex flex-col gap-1 w-full py-1">
        {filteredInfo?.length > 0 && (
          <p className={cn("text-xs text-light-900 break-words", className)}>
            {filteredInfo}
          </p>
        )}
        {errors.map((error, idx) => (
          <span key={idx} className="pl-1 text-xs w-full flex-wrap">
            {error}
          </span>
        ))}
      </div>
    );
  });
}

/** Formats structured unrecognized-keys reports into styled React nodes for display in a toast. */
export function formatUnrecognizedKeysMessage(
  reports: UnrecognizedKeysReport[],
): ReactNode {
  if (!reports.length) return null;

  return reports.map((report, idx) => (
    <div key={idx} className="flex flex-col gap-0.5 w-full py-1">
      <p className="text-xs text-light-700 font-semibold">{report.label}</p>
      {report.entries.map((entry, idx) => (
        <span key={`${entry.name}-${idx}`} className="pl-1 text-xs w-full flex-wrap">
          • {entry.name}: <span className="font-semibold">{entry.keys.join(", ")}</span>
        </span>
      ))}
    </div>
  ));
}

/** Shows a warning toast listing unrecognized keys found in widgets.json / apps.json, with a copy-to-clipboard action. */
export function showUnrecognizedKeysToast(
  source: Partial<Source>,
  reports: UnrecognizedKeysReport[],
) {
  const docsHref = docsUrl("workspace/developers/json-specs/widgets-json-reference");
  toast.warning(`Unrecognized fields: ${source.name}`, {
    id: `backend-unrecognized-keys-${source.id}`,
    descriptionClassName: "relative max-h-80 overflow-y-auto",
    description: (
      <div className="flex flex-col gap-0.5 text-left">
        <div className="flex flex-col gap-1 pl-1">
          {formatUnrecognizedKeysMessage(reports)}
        </div>
      </div>
    ),
    duration: 15000,
    action: (
      <div className="flex items-center justify-between w-full">
        {docsHref ? (
          <a
            href={docsHref}
            target="_blank"
            rel="noopener noreferrer"
            className="flex text-xs underline"
          >
            View docs reference
          </a>
        ) : (
          <span />
        )}
        <button
          id={`copy-unrecognized-keys-${source.id}`}
          className="flex toast-action-btn mt-2 h-6 px-2 py-[4.5px] rounded text-2xs! font-medium!"
          onClick={() => {
            const clipboard = window.navigator?.clipboard;
            if (!clipboard?.writeText) return;
            clipboard.writeText(formatUnrecognizedKeysAsText(reports)).catch(() => {});
          }}
        >
          Copy
        </button>
      </div>
    ),
  });
}

/** What was last announced per backend, so a re-sync of the same problem stays quiet. */
const announcedInvalidItems = new Map<string, string>();

const invalidItemsSignature = (items: InvalidItem[]) =>
  items.map((item) => `${item.file}:${item.id}:${item.errors}`).join("\n");

/** The backends are valid again (or gone): announce them again if they break again. */
export function forgetInvalidItems(sourceIds: (string | undefined)[]) {
  for (const id of sourceIds) if (id) announcedInvalidItems.delete(id);
}

/**
 * Warns that widgets or apps of a backend were skipped because they are invalid. The toast
 * says how many, and opens a dialog with what is wrong with each when it is clicked.
 *
 * A backend is announced once for the same problem, however often it is loaded again. Pass
 * `force` when the user asked for it (a refresh or a new connection).
 */
export function showInvalidItemsToast(
  source: Partial<Source>,
  items: InvalidItem[],
  { force = false }: { force?: boolean } = {},
) {
  if (items.length === 0) return;

  const signature = invalidItemsSignature(items);
  if (source.id) {
    if (!force && announcedInvalidItems.get(source.id) === signature) return;
    announcedInvalidItems.set(source.id, signature);
  }

  toast.warning(`Invalid items in ${source.name}`, {
    id: `backend-invalid-items-${source.id}`,
    description: summarizeInvalidItems(items),
    duration: 20000,
    action: {
      label: "Inspect",
      onClick: () =>
        useInvalidItemsStore.getState().show(source.name ?? "backend", items),
    },
  });
}

export function formatBackendWarningMessage(
  templateWarningMessage: string,
  className?: string,
  warningClassName?: string,
): ReactNode {
  return (
    <div className="flex flex-col gap-2 text-left">
      <div className={cn("text-xs text-light-800", className)}>
        <p className="font-semibold mb-1">App warnings:</p>
        <div className="flex flex-col gap-1">
          {formatZodErrorMessage(templateWarningMessage, warningClassName)}
        </div>
      </div>
    </div>
  );
}

export function formatBackendErrorMessage(
  errorMessage: string | null,
  templateErrorMessage: string | null,
  className?: string,
  errorClassName?: string,
): ReactNode {
  return (
    <div className="flex flex-col gap-2 text-left">
      {errorMessage && (
        <div className={cn("text-xs text-light-800", className)}>
          <div className="flex flex-col gap-1">
            {formatZodErrorMessage(errorMessage, errorClassName)}
          </div>
        </div>
      )}

      {templateErrorMessage && (
        <div className={cn("text-xs text-light-800", className)}>
          <p className="font-semibold mb-1">App errors:</p>
          <div className="flex flex-col gap-1">
            {formatZodErrorMessage(templateErrorMessage, errorClassName)}
          </div>
        </div>
      )}
    </div>
  );
}

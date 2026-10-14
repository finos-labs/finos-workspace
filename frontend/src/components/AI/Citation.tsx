import * as HoverCard from "@radix-ui/react-hover-card";
import clsx from "clsx";
import { forwardRef, memo, useCallback, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { v4 as uuidv4 } from "uuid";
import { getConfig } from "~/lib/runtimeConfig";
import { useShallowAppStore } from "~/lib/state/app";
import {
  type Citation as CitationT,
  type DetailT,
  useShallowCopilotStore,
} from "~/lib/state/copilot";
import { useShallowCopilotDataStore } from "~/lib/state/copilotData";
import {
  cn,
  currentDateModifier,
  dispatchUpdateWidget,
  triggerCustomEvent,
} from "~/lib/utils";
import { isTruthyRecord } from "~/lib/utils/values";
import { isStoredParamValue } from "~/lib/utils/widgetParams";
import { Button } from "../ds/atoms/Button";
import Icon from "../Icon";
import type { IconId } from "../Icon.types";
import type { ParamDef, StoredParamValue, WidgetStorage, WidgetT } from "../types";
import type { WidgetId } from "../Widgets";
import { Artifact, Table } from ".";
import { useExternalLinkAnchorProps } from "./ExternalLinkContext";
import { useShallowAppWidgetsStore } from "./hooks/useGetAppWidgets";
import {
  compareSignatures,
  detectQueryMismatch,
  dispatchCreate,
  normalizeWidgetId,
} from "./hooks/utils";

/**
 * A citation footer either offers an action or explains why there isn't one.
 * `kind: "hint"` renders as a caption, not a disabled button — a dead CTA reads
 * as something the user failed to unlock. The union also makes `onClick`
 * mandatory on real actions instead of silently optional.
 */
type CitationCta =
  | { kind: "hint"; buttonLabel: string }
  | {
      kind?: "action";
      buttonLabel: string;
      onClick: () => void;
      variant?: "primary" | "secondary";
    };

/** The page of a file a citation points to, which the backend sends as a number or a numeric string. */
const toPageNumber = (value: unknown): number | undefined => {
  if (value === null || value === undefined || value === "") return undefined;
  const page = Number(value);
  return Number.isFinite(page) ? page : undefined;
};

const WebCitationTable = ({ content }: { content: DetailT }) => {
  const entries = content ? Object.entries(content) : [];
  const linkEntry = entries.find(([key]) => key.toLowerCase() === "link");
  const anchorProps = useExternalLinkAnchorProps(
    linkEntry ? String(linkEntry[1]) : undefined,
  );

  if (!content) return null;

  if (linkEntry) {
    const titleEntry = entries.find(([key]) => key.toLowerCase() === "title");
    const title = titleEntry ? String(titleEntry[1]) : String(linkEntry[1]);

    return (
      <div className="py-1">
        <a
          href={String(linkEntry[1])}
          target="_blank"
          rel="noopener noreferrer"
          className="ws-hyper-link break-words"
          title={String(linkEntry[1])}
          {...anchorProps}
        >
          {title}
        </a>
      </div>
    );
  }

  return (
    <div className="text-xs">
      {entries.map(([key, value]) => (
        <div key={key} className="grid grid-cols-4 py-0.5">
          <span className="font-bold col-span-1 break-words pr-2">{key}:</span>
          <span className="col-span-3 break-words">{String(value)}</span>
        </div>
      ))}
    </div>
  );
};

type CitationProps = {
  index: number;
  content: CitationT;
};

const ICON_MAP: Record<string, IconId> = {
  "direct retrieval": "code-browser",
  findb: "database",
  widget: "layout-top",
  file: "layout-top",
  web: "link-03",
  artifact: "cube-01",
};

/** What a widget citation says of the widget it cites: its uuid and the arguments it was queried with. */
function getWidgetCitationMetadata(content: CitationT) {
  const metadata = content.source_info?.metadata;
  const widgetUuid =
    typeof metadata?.widget_uuid === "string" ? metadata.widget_uuid : undefined;
  const inputArgs = isTruthyRecord(metadata?.input_args)
    ? metadata.input_args
    : undefined;
  return { widgetUuid, inputArgs };
}

const Citation = forwardRef<HTMLDivElement, CitationProps>((props, _ref) => {
  const { index, content } = props;
  const { widgetUuid: sourceWidgetUuid, inputArgs: citationInputArgs } =
    getWidgetCitationMetadata(content);
  const [isOpen, setIsOpen] = useState(false);
  const { id: currentDashboardId = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();

  const {
    getWidgetsInCurrentDashboard,
    signaturesMap,
    getWidgetFromSignature,
    widgetsLastUpdated,
  } = useShallowCopilotDataStore((state) => ({
    getWidgetsInCurrentDashboard: state.getWidgetsInCurrentDashboard,
    signaturesMap: state.signaturesMap,
    getWidgetFromSignature: state.getWidgetFromSignature,
    widgetsLastUpdated: state.widgetsLastUpdated,
  }));

  const { getWidgetsByAttribute } = useShallowAppStore((state) => ({
    getWidgetsByAttribute: state.getWidgetsByAttribute,
  }));

  const sourceInfo = useMemo(() => {
    let widgetId = content.source_info?.widget_id || content.source_info?.name;
    let widgetOrigin = content.source_info?.origin || "";
    let originalWidgetId = "";
    if (
      ["income_statement", "balance_sheet", "cash_flow_statement"].includes(widgetId)
    ) {
      originalWidgetId = widgetId;
      widgetId = "financial_statements";
    }

    if (["None", "null", null, undefined].some((val) => val === widgetOrigin)) {
      widgetOrigin = "";
    }

    return { widgetId, originalWidgetId, widgetOrigin };
  }, [content.source_info]);
  const isIframeMcpCitation = content.source_info?.metadata?.iframe_mcp === true;

  // Check if a widget with the same signature exists on the current dashboard
  const currentDashboardSignatureMatch = useMemo(() => {
    if (!content.source_info) return null;

    const inputArgs = content.source_info?.metadata?.input_args || {};
    const filteredArgs = Object.entries(inputArgs).reduce(
      (acc, [key, value]) => {
        if (value !== null && value !== undefined) {
          acc[key] = value;
        }
        return acc;
      },
      {} as Record<string, unknown>,
    );
    const citationSignature = {
      origin: sourceInfo?.widgetOrigin,
      widgetId: sourceInfo?.widgetId,
      args: filteredArgs,
    };

    if (sourceWidgetUuid) {
      const directMatch = getWidgetsInCurrentDashboard(sourceWidgetUuid) as WidgetT;
      if (directMatch) {
        if (isIframeMcpCitation) return directMatch;

        if (
          compareSignatures(signaturesMap[directMatch.id], citationSignature) &&
          !detectQueryMismatch(
            citationInputArgs?.query,
            directMatch.storage?.params?.query,
          )
        ) {
          return directMatch;
        }
      }
    }

    let match = getWidgetFromSignature(citationSignature);

    // If no match and we have a widget_id, try to find by widget_id and args only
    // This handles cases where origin might be different or missing
    if (!match && citationSignature?.widgetId) {
      const widgetsInCurrentDashboard = getWidgetsInCurrentDashboard() as WidgetT[];
      const citationWidgetId = normalizeWidgetId(
        citationSignature.widgetId,
        citationSignature.origin,
      );

      match = widgetsInCurrentDashboard?.find((widget) => {
        // Check if widget has the same widgetId and matching args
        const normalizedWidgetId = normalizeWidgetId(
          widget.widgetId,
          widget.sourceName,
        );
        if (normalizedWidgetId !== citationWidgetId) {
          return false;
        }

        // Compare the args
        const widgetArgs = widget.storage?.params || {};
        const argsMatch = Object.keys(filteredArgs).every((key) => {
          const citationValue = filteredArgs[key];
          const widgetValue = widgetArgs[key];

          // Handle array comparison (like for multi-file viewer)
          if (Array.isArray(citationValue) && Array.isArray(widgetValue)) {
            const match =
              JSON.stringify(citationValue.sort()) ===
              JSON.stringify(widgetValue.sort());
            return match;
          }

          // Normal comparison with normalization
          const normalizedCitation = citationValue?.toString?.() || citationValue;
          const normalizedWidget = widgetValue?.toString?.() || widgetValue;
          return normalizedCitation === normalizedWidget;
        });

        return argsMatch;
      });
    }

    return match;
  }, [
    sourceInfo,
    content.source_info,
    isIframeMcpCitation,
    getWidgetFromSignature,
    getWidgetsInCurrentDashboard,
    signaturesMap,
    widgetsLastUpdated,
  ]);

  const dashboardWidget = useMemo(() => {
    // First, try to find the widget on the current dashboard
    const currentDashboardWidget = getWidgetsInCurrentDashboard(
      content.source_info?.uuid || undefined,
    ) as WidgetT;

    // If not found on current dashboard, search across all dashboards
    let crossDashboardWidget: WidgetT | null = null;
    if (!currentDashboardWidget && content.source_info?.uuid) {
      const widgetsByUuid = getWidgetsByAttribute("id", content.source_info.uuid);

      // Find the first widget with matching UUID across all dashboards
      for (const dashboardId in widgetsByUuid) {
        const widgets = widgetsByUuid[dashboardId];
        if (widgets && widgets.length > 0) {
          crossDashboardWidget = widgets[0];
          break;
        }
      }
    }

    const widget = currentDashboardWidget || crossDashboardWidget;

    if (widget && isIframeMcpCitation) return widget;

    // Create signature for matching
    const randomUuid = uuidv4();
    const inputArgs = content.source_info?.metadata?.input_args || {};
    const filteredArgs = Object.entries(inputArgs).reduce(
      (acc, [key, value]) => {
        if (value !== null && value !== undefined) {
          acc[key] = value;
        }
        return acc;
      },
      {} as Record<string, unknown>,
    );

    const signature = {
      origin: sourceInfo?.widgetOrigin || `unknown-origin-${randomUuid}`,
      widgetId: sourceInfo?.widgetId || `unknown-widgetId-${randomUuid}`,
      args: filteredArgs,
    };

    if (widget && compareSignatures(signaturesMap[widget.id], signature)) {
      return widget;
    }

    return getWidgetFromSignature(signature);
  }, [
    sourceInfo,
    content.source_info,
    isIframeMcpCitation,
    getWidgetsInCurrentDashboard,
    signaturesMap,
    getWidgetFromSignature,
    getWidgetsByAttribute,
  ]);

  const widgetInfo = useShallowAppWidgetsStore((s) => {
    const { widgetId, widgetOrigin } = sourceInfo || {};
    const widget = s.getAppWidget(widgetId as WidgetId, widgetOrigin);
    const symbol = citationInputArgs?.symbol;
    const widgetToAdd = widget;
    return { widgetToAdd, symbol };
  });

  const citationInfo = useMemo(() => {
    const widgetToAdd = widgetInfo?.widgetToAdd;

    // Constants
    const citationType = content.source_info.type;
    // File: citations v1, Filename: citations v2
    const fileDetail = content.details?.find(
      (detail) => detail && ("Filename" in detail || "File" in detail),
    );
    const citationIcon = ICON_MAP[fileDetail ? "file" : citationType];

    // Use the properly matched widget from our improved matching logic
    // Prioritize current dashboard signature match over cross-dashboard widget
    const matchedWidget = currentDashboardSignatureMatch || dashboardWidget;

    const elementIdToHighlight =
      (citationType === "widget"
        ? matchedWidget?.id // Only use widget ID if there's an exact signature match
        : citationType === "artifact"
          ? content.source_info?.name
          : "") || "";

    const sourceName =
      citationType === "artifact"
        ? content.source_info?.name.slice(0, -6)
        : content.source_info?.name;

    let label =
      matchedWidget?.name || widgetToAdd?.name || sourceName || index.toString();
    // If this citation represents a matching widget, mark label with an asterisk
    const isMatchingCitation =
      content.source_info?.metadata?.matching === true || isIframeMcpCitation;
    if (isMatchingCitation) label = `${label}*`;

    // For web citations, extract text both before and after | , - , or : separators and choose the shortest
    // This is heuristics in order to get the name of the magazine, publication to show
    if (citationType === "web" && label) {
      const separators = [" | ", " - ", " : "];
      const candidates: string[] = [];

      for (const separator of separators) {
        if (label.includes(separator)) {
          const parts = label.split(separator);
          const beforeSeparator = parts[0]?.trim();
          const afterSeparator = parts[parts.length - 1]?.trim();

          if (beforeSeparator) {
            candidates.push(beforeSeparator);
          }
          if (afterSeparator && afterSeparator !== beforeSeparator) {
            candidates.push(afterSeparator);
          }
        }
      }

      if (candidates.length > 0) {
        // Choose the shortest candidate
        label = candidates.reduce((shortest, current) =>
          current.length < shortest.length ? current : shortest,
        );
      }
    }

    return {
      citationType,
      citationIcon,
      fileDetail,
      elementIdToHighlight,
      label,
      matchedWidget,
    };
  }, [
    content,
    widgetInfo,
    dashboardWidget,
    index,
    currentDashboardSignatureMatch,
    isIframeMcpCitation,
  ]);

  const { highlightWidget, isFullscreen, toggleFullscreen, getCurrentChatArtifact } =
    useShallowCopilotStore((s) => ({
      highlightWidget: s.setHoveredCitationWidgetId,
      isFullscreen: s.isFullscreen,
      toggleFullscreen: s.toggleFullscreen,
      getCurrentChatArtifact: s.getCurrentChatArtifact,
    }));
  const showButtons = useShallowCopilotDataStore(
    (_s) => citationInfo?.citationType !== "web",
  );

  const addWidgetToDashboard = useShallowAppStore((state) => state.addWidget);

  // Get current tab for cross-tab navigation
  const lastInnerTab = useShallowAppStore((state) =>
    state.getLastInnerTab(currentDashboardId),
  );

  const searchParamsTab = searchParams.get("tab");
  const currentTab = useMemo(
    () => searchParamsTab || lastInnerTab || "",
    [lastInnerTab, searchParamsTab],
  );
  const widgetTab = citationInfo.matchedWidget?.innerTab;
  const isWidgetOnDifferentTab = widgetTab && currentTab && widgetTab !== currentTab;

  // Check if the matched widget is the exact same widget (by ID) on the current dashboard
  const isExactWidgetOnCurrentDashboard = useMemo(() => {
    if (!citationInfo.matchedWidget) return false;
    const currentDashboardWidget = getWidgetsInCurrentDashboard(
      citationInfo.matchedWidget.id,
    ) as WidgetT;
    return !!currentDashboardWidget;
  }, [citationInfo.matchedWidget, getWidgetsInCurrentDashboard]);

  /**
   * Detects when Cortex Analyst generated a new SQL query for an existing widget.
   * This is separate from currentDashboardSignatureMatch (which compares against the
   * current-dashboard direct match only). Here we compare against citationInfo.matchedWidget,
   * which may be cross-dashboard, so both checks are needed.
   */
  const hasQueryMismatch = useMemo(
    () =>
      detectQueryMismatch(
        citationInputArgs?.query,
        citationInfo.matchedWidget?.storage?.params?.query,
      ),
    [citationInputArgs?.query, citationInfo.matchedWidget],
  );

  const onMouseEnter = useCallback(() => {
    highlightWidget(citationInfo.elementIdToHighlight);
  }, [citationInfo?.elementIdToHighlight, highlightWidget]);

  const onMouseLeave = useCallback(() => {
    highlightWidget(null);
  }, [highlightWidget]);
  const onTriggerClick = useCallback(() => setIsOpen((prev) => !prev), []);
  const setClose = useCallback(() => {
    setIsOpen(false);
    highlightWidget(null);
  }, [highlightWidget]);

  const handleGoToReference = useCallback(() => {
    const element = document.getElementById(citationInfo.elementIdToHighlight);
    dispatchUpdateWidget(citationInfo.elementIdToHighlight, (prev) => {
      let storageUpdate: WidgetStorage = {};
      if (prev.connectionType === "file") {
        // For some reason the file viewer type is not set as file_viewer
        const page = toPageNumber(citationInfo.fileDetail?.Page);
        const currentQuoteBoundingBoxes = content.quote_bounding_boxes;
        const currentPage = page ?? currentQuoteBoundingBoxes?.[0]?.[0]?.page ?? 1;
        storageUpdate = {
          page: currentPage,
          quoteBoundingBoxes: currentQuoteBoundingBoxes,
        };
      }

      triggerCustomEvent(`updateQueryParams-${prev.id}`, storageUpdate.params ?? {});
      return {
        ...prev,
        storage: {
          ...prev.storage,
          ...storageUpdate,
        },
      };
    });

    element?.scrollIntoView({
      behavior: "smooth",
      block: "center",
      inline: "nearest",
    });
    // Add highlight after a brief delay to ensure scroll is complete
    setTimeout(() => {
      highlightElement(element);
    }, 100);
    setClose();
  }, [content, citationInfo, setClose]);

  const handleCreateWidgetFromArtifact = useCallback(() => {
    // Get the artifact from the copilot store using the artifact name/id from citation
    const artifactId = content.source_info?.name;
    if (!artifactId) {
      toast.error("Artifact reference not found");
      return;
    }

    const artifact = getCurrentChatArtifact(artifactId);

    if (!artifact) {
      toast.error("Artifact not found");
      return;
    }

    // Handle different artifact types with proper typing
    if (artifact.type === "text") {
      dispatchCreate({
        widgetType: "text",
        content: artifact.content as string,
        metadata: {
          uuid: artifact.uuid,
          name: artifact.name,
          description: artifact.description,
        },
      });
    } else {
      toast.error("Unsupported artifact type");
      return;
    }

    setClose();
  }, [content.source_info?.name, getCurrentChatArtifact, setClose]);

  const handleAddWidgetToDashboard = useCallback(async () => {
    const inputArgs = citationInputArgs;

    // Use matched widget when it's cross-dashboard or when query differs (new SQL)
    const sourceWidget =
      citationInfo.matchedWidget &&
      (!isExactWidgetOnCurrentDashboard || hasQueryMismatch)
        ? citationInfo.matchedWidget
        : widgetInfo.widgetToAdd;

    if (!sourceWidget) {
      toast.error("Failed to add widget");
      return;
    }

    const storedParams: Record<string, StoredParamValue> = {
      ...sourceWidget.storage?.params,
    };
    const newStorage: WidgetStorage = { ...sourceWidget.storage, params: storedParams };

    const newParams = inputArgs
      ? sourceWidget.params?.map((param): ParamDef => {
          const paramName = param.paramName;
          const provided = inputArgs[paramName];

          if (provided && provided !== "null" && isStoredParamValue(provided)) {
            // Use provided value from citation input args
            storedParams[paramName] = provided;
            return { ...param, value: provided } as ParamDef;
          }
          // Only apply date modifier if the widget param has a non-null default,
          // else leave unset to preserve empty date selection
          if (
            param.type === "date" &&
            param.value !== null &&
            param.value !== undefined
          ) {
            storedParams[paramName] = currentDateModifier(param.value);
          }
          return param;
        })
      : sourceWidget.params;

    const widget = {
      ...sourceWidget,
      params: newParams,
      storage: newStorage,
      innerTab: currentTab, // Always set the current tab, not just in fullscreen
      id: undefined, // Remove ID to force generation of new ID when adding to dashboard
      gridData: {
        ...sourceWidget.gridData,
        w: 40,
      },
    };

    if (sourceInfo?.originalWidgetId) {
      widget.storage.selectedGroup = sourceInfo.originalWidgetId;
    }

    // Get the new widget ID from addWidgetToDashboard
    const newWidgetId = await addWidgetToDashboard(currentDashboardId, widget);
    if (!newWidgetId) return;

    // Only show toast when in fullscreen mode since user can't see dashboard
    if (isFullscreen) {
      const toastDescription = currentTab
        ? `Check widget '${sourceWidget.name}' on the '${currentTab}' tab`
        : `Check widget '${sourceWidget.name}' on the dashboard`;

      // Show success toast with widget name and Show button
      toast.success("Successfully added widget", {
        description: toastDescription,
        action: {
          label: "Show",
          onClick: () => {
            toggleFullscreen();
            // Wait for the layout to adjust before scrolling
            setTimeout(() => {
              const newWidgetElement = document.getElementById(newWidgetId);
              scrollToElement(newWidgetElement);
            }, 600);
          },
        },
      });
    }

    setClose();

    // Scroll to the newly added widget after a brief delay
    setTimeout(() => {
      const newWidgetElement = document.getElementById(newWidgetId);
      scrollToElement(newWidgetElement);
    }, 300);
  }, [
    citationInfo,
    currentDashboardId,
    isFullscreen,
    toggleFullscreen,
    widgetInfo,
    addWidgetToDashboard,
    content,
    sourceInfo?.originalWidgetId,
    setClose,
    currentTab,
    isExactWidgetOnCurrentDashboard,
    hasQueryMismatch,
  ]);

  // Handler for navigating to widget's tab
  const handleGoToTab = useCallback(() => {
    if (!widgetTab) return;

    if (isFullscreen) {
      toggleFullscreen();
    }

    setSearchParams({ tab: widgetTab });
    setClose();

    // Delay to allow UI to update (fullscreen exit, tab switch)
    setTimeout(
      () => {
        const element = document.getElementById(citationInfo.elementIdToHighlight);
        scrollToElement(element);
      },
      isFullscreen ? 600 : 300,
    ); // Longer delay when exiting fullscreen
  }, [
    widgetTab,
    isFullscreen,
    toggleFullscreen,
    setSearchParams,
    setClose,
    citationInfo.elementIdToHighlight,
  ]);

  // Button display and behavior
  const citationButtonsProps = useMemo((): CitationCta[] => {
    const { citationType, elementIdToHighlight, fileDetail, matchedWidget } =
      citationInfo;
    // Use the MCP matching flag carried by the citation
    const isMatchingCitation = content.source_info?.metadata?.matching === true;

    if (!currentDashboardId) {
      return [{ kind: "hint", buttonLabel: "Open a dashboard to add this widget" }];
    }

    // Use signature-matched widget for more accurate comparison
    if (matchedWidget || elementIdToHighlight) {
      // If we have a signature match on current dashboard, use that widget for actions
      const targetWidget = currentDashboardSignatureMatch || matchedWidget;
      const targetWidgetId = currentDashboardSignatureMatch?.id || elementIdToHighlight;

      // If no signature match on current dashboard, or query differs (new SQL), show add button
      if (
        hasQueryMismatch ||
        !(currentDashboardSignatureMatch || isExactWidgetOnCurrentDashboard)
      ) {
        // For artifacts, show "Create widget from artifact" button
        if (citationType === "artifact") {
          return [
            {
              buttonLabel: "Create widget from artifact",
              onClick: handleCreateWidgetFromArtifact,
            },
          ];
        }

        return [
          {
            buttonLabel: isMatchingCitation
              ? "Add matching widget to dashboard"
              : "Add widget to dashboard",
            onClick: handleAddWidgetToDashboard,
          },
        ];
      }

      // Check if target widget is on different tab (only for current dashboard widgets)
      const targetWidgetTab = targetWidget?.innerTab;
      const isTargetWidgetOnDifferentTab =
        currentDashboardSignatureMatch &&
        targetWidgetTab &&
        currentTab &&
        targetWidgetTab !== currentTab;

      if (isTargetWidgetOnDifferentTab) {
        return [
          {
            buttonLabel: isFullscreen ? "Show widget" : "Go to tab",
            onClick: handleGoToTab,
            variant: "primary" as const,
          },
        ];
      }
      const hasPage = fileDetail?.Page;
      const hasQuoteBoundingBoxes = content.quote_bounding_boxes?.length;
      const hasReference = hasPage || hasQuoteBoundingBoxes;

      if (hasReference) {
        return [{ buttonLabel: "Go to reference", onClick: handleGoToReference }];
      }
      if (citationType === "artifact") {
        return [
          {
            buttonLabel: "Scroll to artifact",
            onClick: () => {
              const element = document.getElementById(targetWidgetId);
              scrollToElement(element);
            },
          },
        ];
      }

      return [
        {
          buttonLabel: isFullscreen
            ? "Show widget"
            : matchedWidget && isMatchingCitation
              ? "Scroll to matching widget"
              : "Scroll to widget",
          onClick: () => {
            if (isFullscreen) {
              toggleFullscreen();
              // Wait for the layout to adjust before scrolling
              setTimeout(() => {
                const newWidgetElement = document.getElementById(targetWidgetId);
                scrollToElement(newWidgetElement);
              }, 600);
            } else {
              const newWidgetElement = document.getElementById(targetWidgetId);
              scrollToElement(newWidgetElement);
            }
            setClose();
          },
        },
      ];
    }

    // For artifacts without matched widgets, show create widget button
    if (citationType === "artifact") {
      return [
        {
          buttonLabel: "Create widget from artifact",
          onClick: handleCreateWidgetFromArtifact,
        },
      ];
    }

    if (widgetInfo?.widgetToAdd) {
      return [
        {
          buttonLabel: isMatchingCitation
            ? "Add matching widget to dashboard"
            : "Add widget to dashboard",
          onClick: handleAddWidgetToDashboard,
        },
      ];
    }

    return [{ kind: "hint", buttonLabel: "Widget not on current dashboard" }];
  }, [
    citationInfo,
    currentDashboardId,
    isWidgetOnDifferentTab,
    isExactWidgetOnCurrentDashboard,
    currentDashboardSignatureMatch,
    hasQueryMismatch,
    handleAddWidgetToDashboard,
    handleCreateWidgetFromArtifact,
    handleGoToReference,
    handleGoToTab,
    widgetInfo?.widgetToAdd,
    isFullscreen,
    content.quote_bounding_boxes?.length,
    toggleFullscreen,
    setClose,
    currentTab,
  ]);

  const triggerMemo = useMemo(
    () => (
      <HoverCard.Trigger
        className={cn(
          "mx-0.5 cursor-pointer inline-flex items-center justify-center px-1 py-px relative no-underline rounded-xs text-2xs break-words",
          "bg-light-50 dark:bg-dark-500 border border-light-300 dark:border-dark-400 text-brand-darker dark:text-brand-lighter",
        )}
        style={{ verticalAlign: "baseline" }}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onClick={onTriggerClick}
      >
        {citationInfo?.citationIcon && (
          <div className="flex items-center gap-1">
            <Icon
              id={citationInfo?.citationIcon}
              className="h-2.5 w-2.5 flex-shrink-0"
            />
            <span className="text-2xs font-medium leading-none break-words">
              {citationInfo?.label}
            </span>
          </div>
        )}
      </HoverCard.Trigger>
    ),
    [
      citationInfo?.citationIcon,
      citationInfo?.label,
      onMouseEnter,
      onMouseLeave,
      onTriggerClick,
    ],
  );

  // Compute the detail objects that will actually render after restructuring and
  // filtering. A citation can carry details whose fields are all skipped/empty,
  // so we resolve them here instead of inferring from `content.details.length`.
  const renderableDetails = useMemo(() => {
    if (!content?.details) return [];

    return content.details
      .map((detail) => {
        if (!detail) return null;

        const enhancedDetail = { ...detail };

        // Filter out null/undefined values and unwanted fields from detail before rendering
        const filteredDetail = Object.entries(enhancedDetail).reduce(
          (acc, [key, value]) => {
            // Skip unwanted fields (only for display, don't affect functionality)
            if (
              key === "Source type" ||
              key === "Origin" ||
              key === "Data source" ||
              key === "Name" ||
              (isIframeMcpCitation &&
                (key === "Widget" || key === "Server" || key === "Tool"))
            ) {
              return acc;
            }

            // Skip null, undefined, "null", "None" (Python None converted to string)
            if (
              value !== null &&
              value !== undefined &&
              value !== "null" &&
              value !== "None" &&
              value !== "none"
            ) {
              const displayKey = key;
              const displayValue = value;

              // Clean up Python list strings like "['UNRATE']" to just "UNRATE"
              if (typeof displayValue === "string") {
                // Check if it's a string representation of a Python single-item list
                const singleItemListMatch =
                  displayValue.match(/^\[['"]([^'"]+)['"]\]$/);
                if (singleItemListMatch) {
                  acc[displayKey] = singleItemListMatch[1];
                } else {
                  acc[displayKey] = displayValue;
                }
              } else {
                acc[displayKey] = displayValue;
              }
            }
            return acc;
          },
          {} as Record<string, unknown>,
        );

        // Drop details whose values were all filtered out
        if (Object.keys(filteredDetail).length === 0) return null;

        return filteredDetail;
      })
      .filter((detail): detail is Record<string, unknown> => detail !== null);
  }, [content?.details, isIframeMcpCitation]);

  if (citationInfo?.citationIcon === undefined) return null;

  // Whether the hover card renders a content area above the action button.
  // Artifact citations keep their original details-only gating; other citations
  // also count artifacts. Without this, a citation whose details all filter out
  // renders an empty content area and the single action button still gets its
  // `mt-2`, leaving lopsided top padding.
  const hasContentAbove =
    citationInfo.citationType === "artifact"
      ? renderableDetails.length > 0
      : renderableDetails.length > 0 || (content?.artifacts?.length ?? 0) > 0;

  return (
    <HoverCard.Root open={isOpen} openDelay={300} onOpenChange={setIsOpen}>
      {triggerMemo}
      <HoverCard.Portal>
        <HoverCard.Content
          side="bottom"
          align="start"
          className={clsx(
            "bottom-full my-1 prose-sm z-60 flex animate-fade-in flex-col gap-1 rounded bg-light-50 p-2 text-light-600 text-xs dark:prose-invert font-medium dark:text-light-300 prose-p:my-1.5 shadow-sm dark:bg-dark-750 dark:shadow-[0_2px_10px_0_rgba(0,0,0,0.80)]",
            {
              "w-[400px]":
                (content?.artifacts?.length ?? 0) > 0 &&
                citationInfo.citationType !== "web",
              "max-w-[400px]": citationInfo.citationType !== "web",
              "max-w-[280px]": citationInfo.citationType === "web",
            },
          )}
          onMouseEnter={onMouseEnter}
          onMouseLeave={onMouseLeave}
        >
          {/* Only show the content area when there is actual detail or artifact content to render */}
          {hasContentAbove && (
            <div
              className="prose-sm rounded text-xs font-medium text-light-600
              prose-p:my-1.5 dark:text-light-300 dark:prose-invert
              overflow-y-auto overflow-x-hidden max-h-[250px]"
            >
              {renderableDetails.map((filteredDetail, index) =>
                citationInfo.citationType === "web" ? (
                  <WebCitationTable key={index} content={filteredDetail} />
                ) : (
                  <Table key={index} content={filteredDetail} disableAutoLink={true} />
                ),
              )}
              <div className="space-y-3">
                {content?.artifacts?.map((artifact, index) => (
                  <Artifact key={index} artifact={artifact} />
                ))}
              </div>
            </div>
          )}
          {showButtons && (
            <div
              className={
                citationButtonsProps.length > 1 ? "flex gap-2 mt-2" : "space-y-2"
              }
            >
              {citationButtonsProps.map((button, index) => {
                if (button.kind === "hint") {
                  return (
                    <p
                      key={index}
                      className={clsx(
                        "text-center text-ds-text-caption body-xs-regular",
                        hasContentAbove &&
                          "mt-2 pt-2 border-t border-general-border-secondary",
                      )}
                    >
                      {button.buttonLabel}
                    </p>
                  );
                }

                return (
                  <Button
                    key={index}
                    size="xs"
                    variant={button.variant || "primary"}
                    className={
                      citationButtonsProps.length > 1
                        ? "flex-1"
                        : `w-full ${index === 0 && hasContentAbove ? "mt-2" : ""}`
                    }
                    onClick={button.onClick}
                  >
                    {button.buttonLabel}
                  </Button>
                );
              })}
            </div>
          )}
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  );
});

export default memo(Citation);

const scrollToElement = (element: HTMLElement | null) => {
  element?.scrollIntoView({
    behavior: "smooth",
    block: "center",
    inline: "nearest",
  });
  // Add highlight after a brief delay to ensure scroll is complete
  setTimeout(() => {
    highlightElement(element);
  }, 100);
};

const highlightElement = (element: HTMLElement | null) => {
  if (!element) return;

  // Use the same styling as hover: outline-2 outline-brand-main
  element.classList.add("outline-2", "outline-brand-main");

  // Inject custom CSS for fade-out animation if not already present
  if (!document.getElementById("citation-highlight-styles")) {
    const mainColor = getConfig().whiteLabel.mainColor ?? "#0086BF";
    const style = document.createElement("style");
    style.id = "citation-highlight-styles";
    style.textContent = `
        @keyframes outline-fade-out {
          0% { outline-color: ${mainColor}; }
          30% { outline-color: ${mainColor}b3; }
          60% { outline-color: ${mainColor}66; }
          85% { outline-color: ${mainColor}1a; }
          100% { outline-color: transparent; }
        }
      `;
    document.head.appendChild(style);
  }

  // Start fade-out animation immediately
  setTimeout(() => {
    element.style.animation = "outline-fade-out 1.3s ease-out forwards";

    // Clean up after animation completes
    setTimeout(() => {
      element.classList.remove("outline-2", "outline-brand-main");
      element.style.animation = "";
    }, 1300);
  }, 50);
};

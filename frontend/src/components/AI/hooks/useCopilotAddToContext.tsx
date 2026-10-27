import { useVirtualizer } from "@tanstack/react-virtual";
import type React from "react";
import {
  type MutableRefObject,
  memo,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
} from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { useDebouncedCallback } from "use-debounce";
import { v4 as uuidv4 } from "uuid";
import { WidgetNameItem } from "~/components/AI/WidgetTooltipItem";
import Icon from "~/components/Icon";
import Tooltip from "~/components/Tooltip";
import type { WidgetT } from "~/components/types";
import type { WidgetId } from "~/components/Widgets";
import useIsMobile from "~/hooks/useIsMobile";
import { useCallbackRef } from "~/hooks/useRefHooks";
import { useStateReducer } from "~/hooks/useStateReducer";
import { useAppStore, useShallowAppStore } from "~/lib/state/app";
import {
  type CopilotWidget,
  type HierarchicalMention,
  type Mention,
  useShallowCopilotStore,
} from "~/lib/state/copilot";
import {
  type DashboardWidgetData,
  useShallowCopilotDataStore,
} from "~/lib/state/copilotData";
import { cn } from "~/lib/utils";
import type { TextAreaProps } from "../TextArea";
import { useShallowAppWidgetsStore } from "./useGetAppWidgets";
import { createCopilotWidget } from "./useGetCopilotWidgets";
import { useMentions } from "./useMentions";
import { dispatchCopilotCommand } from "./utils";

type ContextSuggestionsProps = {
  inputRef?: RefObject<HTMLInputElement | HTMLTextAreaElement>;
  suggestionsRef?: RefObject<HTMLDivElement>;
  fromTextArea?: boolean;
  textAreatype?: TextAreaProps["type"];
  setIsDropdownOpen?: (isOpen: boolean) => void;
  onSuggestionClickRef?: MutableRefObject<
    ((suggestion: HierarchicalMention) => void) | null
  >;
  getSearchQuery?: () => string;
};

function focusCopilotInput() {
  const inputElement = document.getElementById("copilot-input");
  if (inputElement) inputElement.focus();
}

export function useCopilotContextSuggestions(props: ContextSuggestionsProps) {
  const {
    inputRef,
    suggestionsRef,
    fromTextArea = false,
    textAreatype,
    onSuggestionClickRef,
  } = props;
  const isMobile = useIsMobile();
  const setIsDropdownOpen = useCallbackRef((isOpen: boolean) =>
    props.setIsDropdownOpen?.(isOpen),
  );

  const { id: currentDashboardId } = useParams();
  const [searchParams] = useSearchParams();
  const lastInnerTab = useShallowAppStore((state) =>
    state.getLastInnerTab(currentDashboardId ?? ""),
  );

  const currentInnerTab = useMemo(
    () => searchParams.get("tab") || lastInnerTab || "",
    [lastInnerTab, searchParams.get("tab")],
  );
  const copilot = useShallowCopilotDataStore((state) => ({
    selectedWidgets: fromTextArea ? [] : state.copilotWidgets.selectedWidgets,
    toggleSelectedWidget: state.toggleSelectedWidget,
    getCopilotWidgets: state.getCopilotWidgets,
    addMentionTrackedWidget: state.addMentionTrackedWidget,
    setCopilotWidgets: state.setCopilotWidgets,
    addDataOnDashboardWidget: state.addDataOnDashboardWidget,
    getDashboardWidgetData: state.getDashboardWidgetData,
    addPreSelectedWidget: state.addPreSelectedWidget,
  }));

  const { lastUpdated, getAppWidget } = useShallowAppWidgetsStore((s) => ({
    lastUpdated: s.lastUpdated,
    getAppWidget: s.getAppWidget,
  }));

  const setHovered = useShallowCopilotStore((state) => state.setHovered);
  const [state, dispatch] = useStateReducer<DropdownState>({
    searchQuery: "",
    suggestions: [],
    selectionIndex: 0,
    isDropdownOpen: false,
    pendingSelection: false,
  });

  const resetState = useCallbackRef(() => {
    if (!state.pendingSelection) return;
    dispatch({
      searchQuery: "",
      selectionIndex: 0,
      isDropdownOpen: false,
      pendingSelection: false,
      ...(fromTextArea ? { suggestions: [] } : {}),
    });
    setIsDropdownOpen?.(false);
  });

  const getSearchQuery = useCallbackRef(() => {
    if (props.getSearchQuery) return props.getSearchQuery();

    return inputRef?.current?.value || "";
  });

  const { search, removeMentionFromText } = useMentions();

  const searchDebounced = useDebouncedCallback((query: string) => {
    dispatch({ suggestions: search(`@${query}`) });
  }, 500);

  useEffect(() => {
    if (state.isDropdownOpen || fromTextArea) return;
    searchDebounced(state.searchQuery);
  }, [copilot.selectedWidgets, search, state.searchQuery]);

  const searchSuggestions = useCallback(
    (query: string, threshold = 0) => {
      if (query === null || query === undefined) {
        resetState();
        return [];
      }

      const searchQuery = fromTextArea ? query : `@${query}`;
      const suggestions = search(searchQuery, threshold);

      dispatch({
        searchQuery: searchQuery.replace(/^@/, ""),
        suggestions,
        selectionIndex: 0,
        pendingSelection: true,
        ...(!fromTextArea && { isDropdownOpen: true }),
      });
      setIsDropdownOpen?.(true);
      setHovered();
      return suggestions;
    },
    [search],
  );

  const handleRemoveMentionFromText = useCallback(
    (widgetUuid: string) => {
      dispatchCopilotCommand((prev) => {
        const updatedText = removeMentionFromText(prev, widgetUuid);
        if (updatedText === prev) return prev;
        return updatedText;
      });
      queueMicrotask(focusCopilotInput);
    },
    [removeMentionFromText],
  );

  const selectedWidgetUuids = useMemo(
    () =>
      new Set(
        copilot.selectedWidgets
          ?.map((widget) => widget.uuid)
          .filter((uuid): uuid is string => Boolean(uuid)) || [],
      ),
    [copilot.selectedWidgets],
  );

  const suggestions = useMemo(() => {
    const rawSuggestions = state.suggestions;
    if (rawSuggestions.length === 0) return [];

    const searchQuery = state.searchQuery || "";

    const filteredByType = rawSuggestions.filter(
      (suggestion) =>
        suggestion.group === "dashboard" ||
        suggestion.group === "all" ||
        suggestion.group === "tab",
    );

    const baseFiltered = filteredByType.filter((suggestion) => {
      if (
        !fromTextArea &&
        suggestion.content?.uuid &&
        selectedWidgetUuids.has(suggestion.content.uuid)
      ) {
        return false;
      }

      if (
        suggestion.group === "tab" &&
        suggestion.content?.metadata?.widgetCount === 0
      ) {
        return false;
      }
      return true;
    });

    const selectedTabWidgets = copilot.selectedWidgets?.filter((widget) =>
      widget.widget_id?.startsWith("tab_"),
    );

    const selectedTabUuids = new Set(
      selectedTabWidgets
        .map((widget) => widget.uuid)
        .filter((uuid): uuid is string => Boolean(uuid)),
    );
    const isTabSelected = isTabSelectedFn(selectedTabUuids);
    const isTabFullySelected = isTabFullySelectedFn(selectedWidgetUuids);
    const isParentTabSelected = isParentTabSelectedFn(filteredByType, selectedTabUuids);

    if (searchQuery.trim()) {
      let filteredResults = baseFiltered;
      if (fromTextArea) {
        filteredResults = baseFiltered.filter((suggestion) => {
          if (
            suggestion.group === "tab" &&
            (isTabSelected(suggestion) || isTabFullySelected(suggestion))
          )
            return false;

          if (
            suggestion.group === "dashboard" &&
            suggestion.content?.uuid &&
            isParentTabSelected(suggestion.content.uuid)
          )
            return false;

          return true;
        });
      }

      const sortedResults = filteredResults.sort((a, b) => {
        if (a.group === "tab" && b.group !== "tab") return -1;
        if (a.group !== "tab" && b.group === "tab") return 1;
        return 0;
      });

      return sortedResults;
    }

    const tabSuggestions = baseFiltered.filter((s) => {
      if (
        s.group === "tab" &&
        !fromTextArea &&
        (isTabSelected(s) || isTabFullySelected(s))
      )
        return false;

      return s.group === "tab";
    });

    const hierarchicalSuggestions: HierarchicalMention[] = [];

    const createHierarchicalCopy = (tabSuggestion: Mention) => {
      hierarchicalSuggestions.push(tabSuggestion);

      const tabWidgets = tabSuggestion.content?.metadata?.tabWidgets || [];
      for (const tabWidget of tabWidgets) {
        if (!tabWidget.uuid) continue;
        if (!fromTextArea && selectedWidgetUuids.has(tabWidget.uuid)) continue;
        if (!fromTextArea && isParentTabSelected(tabWidget.uuid)) continue;

        const widgetSuggestion = {
          id: `widget_id=${tabWidget.widget_id}&uuid=${tabWidget.uuid}`,
          group: "dashboard" as const,
          trigger: "@",
          name: (tabWidget.name || tabWidget.widget_id || "Unnamed widget")
            .replace(/ /g, "\u00A0")
            .replace(/-/g, "\u2011"),
          description: tabWidget.description,
          content: {
            ...tabWidget,
            origin: tabWidget.origin || "Workspace",
          },
          _isChildWidget: true,
          _parentTabId: tabSuggestion.content?.metadata?.innerTabId,
        } as HierarchicalMention;
        hierarchicalSuggestions.push(widgetSuggestion);
      }
    };

    const currentTabSuggestion = tabSuggestions.find(
      (tab) => tab.content?.metadata?.innerTabId === currentInnerTab,
    );

    if (currentTabSuggestion) createHierarchicalCopy(currentTabSuggestion);

    const otherTabs = tabSuggestions
      .filter((tab) => tab.content?.metadata?.innerTabId !== currentInnerTab)
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const tabSuggestion of otherTabs) createHierarchicalCopy(tabSuggestion);

    const tabChildWidgetUuids = new Set<string>();
    if (!fromTextArea) {
      const addTabChildWidgetUuids = addTabChildWidgetUuidsFn(tabChildWidgetUuids);

      if (currentTabSuggestion?.content)
        addTabChildWidgetUuids(currentTabSuggestion.content);

      for (const suggestion of otherTabs) {
        if (suggestion.content) addTabChildWidgetUuids(suggestion.content);
      }

      for (const selectedTab of selectedTabWidgets) addTabChildWidgetUuids(selectedTab);
    }

    let dashboardWidgetsNoTab: HierarchicalMention[] = [];
    if (tabSuggestions.length === 0 || !fromTextArea) {
      dashboardWidgetsNoTab = baseFiltered
        .filter((s) => {
          if (!fromTextArea && s.group === "dashboard") {
            if (!s.content?.uuid) return true;
            const notIncluded = !(
              s.content?.uuid && tabChildWidgetUuids.has(s.content.uuid)
            );
            return !isParentTabSelected(s.content.uuid) && notIncluded;
          }
          return s.group === "dashboard";
        })
        .sort((a, b) => a.name.localeCompare(b.name));

      for (const widget of dashboardWidgetsNoTab) {
        if (!hierarchicalSuggestions.some((s) => s.id === widget.id))
          hierarchicalSuggestions.push(widget);
      }
    }

    const allWidgets = baseFiltered
      .filter((s) => {
        if (!fromTextArea && s.group === "all")
          return !dashboardWidgetsNoTab.some((d) => d.id === s.id);
        return s.group === "all";
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const widget of allWidgets) hierarchicalSuggestions.push(widget);

    return hierarchicalSuggestions;
  }, [state.suggestions, selectedWidgetUuids, state.searchQuery, currentInnerTab]);

  const getRichWidgetTooltip = useCallback(
    (data: CopilotWidget | HierarchicalMention, withTooltip = true) => {
      const { widget, name, isTab, isMention } = getSuggestionInfo(data);
      if (isMention && !widget) return name;

      const title = widget.name || "";

      if (isTab && widget.metadata) {
        const id = widget.uuid || uuidv4();

        const element = (
          <TabGroupElement
            widget={widget}
            getAppWidget={getAppWidget}
            onMouseEnter={(tabId) => {
              if (tabId) {
                setHovered({ tabId });
              }
            }}
            onMouseLeave={() => setHovered()}
            onWidgetMouseEnter={(widgetUuid) => {
              if (widgetUuid) {
                setHovered({ widgetUuid });
              }
            }}
            onWidgetMouseLeave={() => {
              setHovered();
            }}
          />
        );

        if (fromTextArea || !withTooltip) return element;

        return (
          <Tooltip
            id={`tab-tooltip-${id}`}
            key={`tab-tooltip-${id}`}
            position="top"
            message={element}
          >
            <div className="flex items-center gap-2" key={`tab-${id}`}>
              <Icon id="folder-closed" className="w-3 h-3" />
              <span className="truncate max-w-[10rem]">{title}</span>
            </div>
          </Tooltip>
        );
      }

      const description = widget.description || "";
      const widgetId = widget.widget_id || "";

      const widgetDefinition = getAppWidget(widgetId as WidgetId);

      const element = title ? (
        <TabWidgetElement tabWidget={widget} widgetDefinition={widgetDefinition} />
      ) : (
        <span>{description || "Widget"}</span>
      );

      if (fromTextArea || !withTooltip) return element;

      return (
        <Tooltip
          id={`widget-tooltip-${widget.uuid || widgetId}`}
          key={`widget-tooltip-${widget.uuid || widgetId}`}
          position="top"
          message={element}
        >
          <span className="truncate max-w-[10rem]">{title}</span>
        </Tooltip>
      );
    },
    [getAppWidget, lastUpdated, currentDashboardId, currentInnerTab, fromTextArea],
  );

  const virtualizerScrollRef = useRef<((index: number) => void) | null>(null);

  const handleSelection = useCallbackRef(async (suggestion: HierarchicalMention) => {
    if (textAreatype === "promptDialog") return resetState();

    if (!verifySuggestionIntegrity(suggestion)) return;

    suggestion._isChildWidget = undefined;
    suggestion._parentTabId = undefined;

    const selectedWidgets = copilot.getCopilotWidgets().selectedWidgets || [];

    const updates = {
      uuid: suggestion.content?.uuid,
      trackedWidget: null as Action | null,
      toggleSelected: false,
      preSelectedWidget: null as Action | null,
      addDataOnDashboardWidget: null as DashboardWidgetData | null,
      addSelectedWidget: null as CopilotWidget | null,
    };

    const isAlreadyInContext =
      suggestion.content?.uuid &&
      selectedWidgets?.some((w) => w.uuid === suggestion.content?.uuid);

    if (suggestion.group === "tab" && suggestion.content) {
      if (isAlreadyInContext && fromTextArea) {
        updates.preSelectedWidget = copilot.addPreSelectedWidget;
      } else if (!isAlreadyInContext) {
        updates.addSelectedWidget = suggestion.content;
        updates.toggleSelected = true;
        updates.addDataOnDashboardWidget = {
          title: suggestion.content.name,
          description: suggestion.content.description,
          metadata: {
            ...suggestion.content.metadata,
            widgetId: suggestion.content.widget_id,
            name: suggestion.content.name,
          },
          data: null,
        };
        if (fromTextArea) {
          updates.trackedWidget = copilot.addMentionTrackedWidget;
        } else {
          updates.preSelectedWidget = copilot.addPreSelectedWidget;
        }
      }
    } else if (
      suggestion.group === "all" &&
      suggestion.content &&
      !suggestion.content.uuid
    ) {
      try {
        if (!currentDashboardId) {
          queueMicrotask(focusCopilotInput);
          resetState();
          return toast.warning("Not in a dashboard", {
            description:
              "Since you are not in a dashboard, you won't be able to add the tagged widget to one.",
          });
        }

        const widgetId = suggestion.content.widget_id;
        const originalWidget = getAppWidget(widgetId as WidgetId);

        if (!originalWidget)
          throw new Error(`Widget definition not found for widgetId: ${widgetId}`);

        const virtualWidgetUuid = uuidv4();
        updates.uuid = virtualWidgetUuid;

        const widgetToAdd = {
          ...originalWidget,
          id: virtualWidgetUuid,
          innerTab: currentInnerTab || "",
        } as WidgetT;

        const virtualWidget = createCopilotWidget(virtualWidgetUuid, widgetToAdd);
        if (!virtualWidget) {
          throw new Error(`Unable to create the widget for widgetId: ${widgetId}`);
        }
        updates.addSelectedWidget = virtualWidget;
        updates.toggleSelected = true;
        if (fromTextArea) {
          updates.trackedWidget = copilot.addMentionTrackedWidget;
        } else {
          updates.preSelectedWidget = copilot.addPreSelectedWidget;
        }
        updates.addDataOnDashboardWidget = {
          title: widgetToAdd.name,
          description: widgetToAdd.description || "",
          metadata: { widget_id: virtualWidget.widget_id, name: virtualWidget.name },
          data: null,
        };

        updates.addSelectedWidget = {
          origin: suggestion.content.origin ?? "Workspace",
          widget_id: suggestion.content.widget_id,
          uuid: virtualWidgetUuid,
          name: widgetToAdd.name,
          description: widgetToAdd.description ?? "",
          params: suggestion.content.params ?? [],
          metadata: widgetToAdd.metadata ?? {},
        };

        if (fromTextArea) {
          toast.info("Add widget to dashboard", {
            description: `Add "${suggestion.content.name}" to your dashboard.`,
            action: {
              label: "Add widget",
              onClick: () => {
                if (!currentDashboardId) {
                  toast.warning("Not in a dashboard", {
                    description:
                      "Since you are not in a dashboard, you won't be able to add the tagged widget to one.",
                  });
                  return;
                }

                useAppStore.getState().addWidget(currentDashboardId, widgetToAdd);
                toast.success("Widget added to dashboard", {
                  id: `copilot-add-widget-${virtualWidgetUuid}`,
                  description: `"${suggestion.content?.name}" has been added to your dashboard and agent context.`,
                });
              },
            },
          });
        } else {
          useAppStore.getState().addWidget(currentDashboardId, widgetToAdd);
          toast.success("Widget added to dashboard", {
            id: `copilot-add-widget-${virtualWidgetUuid}`,
            description: `"${widgetToAdd.name}" has been added to your dashboard and agent context.`,
          });
        }
      } catch (error) {
        toast.error("Failed to add widget", {
          description: "There was an error while adding the widget to the dashboard.",
        });
      }
    } else if (
      suggestion.content?.uuid &&
      (!fromTextArea || suggestion.group === "dashboard" || suggestion.group === "all")
    ) {
      if (isAlreadyInContext && fromTextArea) {
        updates.preSelectedWidget = copilot.addPreSelectedWidget;
      } else if (!isAlreadyInContext) {
        const dashboardWidgetData = copilot.getDashboardWidgetData(
          suggestion.content.uuid,
        );

        if (!dashboardWidgetData && (!fromTextArea || suggestion._isChildWidget)) {
          updates.addDataOnDashboardWidget = {
            title: suggestion.content.name,
            description: suggestion.content.description || "",
            metadata: suggestion.content.metadata || {},
            data: null,
          };
        }

        updates.toggleSelected = true;
        if (fromTextArea) {
          updates.trackedWidget = copilot.addMentionTrackedWidget;
          updates.addSelectedWidget = suggestion.content;
        } else {
          updates.preSelectedWidget = copilot.addPreSelectedWidget;
        }
      }
    }

    if (updates.addSelectedWidget)
      copilot.setCopilotWidgets({
        selectedWidgets: [
          ...(copilot.getCopilotWidgets().selectedWidgets || []),
          updates.addSelectedWidget,
        ],
      });

    const { uuid } = updates;
    if (uuid) {
      if (updates.addDataOnDashboardWidget)
        copilot.addDataOnDashboardWidget(uuid, updates.addDataOnDashboardWidget);

      updates.toggleSelected && copilot.toggleSelectedWidget(uuid);
      updates.preSelectedWidget?.(uuid);
      updates.trackedWidget?.(uuid);
    }

    queueMicrotask(focusCopilotInput);
    resetState();
    setHovered();
  });

  const handleKeyDown = useCallbackRef((e: React.KeyboardEvent) => {
    const fromContextButton = !fromTextArea;
    if (!state.isDropdownOpen && fromContextButton) return;

    if (suggestions.length === 0) {
      if (e.key === "Escape") {
        e.preventDefault();
        resetState();
        setHovered();
      }
      return;
    }
    let newIndex = null;
    const currentIndex = state.selectionIndex % suggestions?.length;
    const arrLength = suggestions.length;
    if (e.key === "Space" && fromTextArea) return suggestions[currentIndex];

    if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      newIndex = currentIndex === arrLength - 1 ? 0 : state.selectionIndex + 1;
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      newIndex = currentIndex === 0 ? suggestions.length - 1 : state.selectionIndex - 1;
    } else if (e.key === "Enter" || (fromTextArea && e.key === "Tab")) {
      e.preventDefault();
      e.stopPropagation();

      if (suggestions[state.selectionIndex]) {
        const currentSuggestion = suggestions[state.selectionIndex];

        if (verifySuggestionIntegrity(currentSuggestion)) {
          if (!fromTextArea) handleSelection(currentSuggestion);
          return currentSuggestion;
        }
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      resetState();
      setHovered();
    }

    if (newIndex !== null) {
      const currentSuggestion = suggestions[newIndex];
      virtualizerScrollRef.current?.(newIndex);
      dispatch({ selectionIndex: newIndex });
      const hoveredUpdate: { tabId: string | null; widgetUuid: string | null } = {
        tabId: null,
        widgetUuid: null,
      };
      if (
        currentSuggestion?.group === "tab" &&
        currentSuggestion.content?.metadata?.innerTabId
      ) {
        hoveredUpdate.tabId = currentSuggestion.content.metadata.innerTabId;
      } else if (currentSuggestion?.content?.uuid) {
        hoveredUpdate.widgetUuid = currentSuggestion.content.uuid;
      }

      setHovered(hoveredUpdate);
    }
  });

  const handleClickOutside = useCallback(
    (event: MouseEvent) => {
      const target = event.target as Node;
      if (suggestionsRef?.current && !suggestionsRef.current.contains(target)) {
        resetState();
        if (!fromTextArea && inputRef?.current) inputRef.current.value = "";
      }
    },
    [inputRef, suggestionsRef, resetState],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    document.addEventListener("mousedown", handleClickOutside, {
      signal: ctrl.signal,
      passive: true,
    });
    return () => ctrl.abort();
  }, [inputRef, suggestionsRef]);

  const suggestionElements = useMemo(
    () => (
      <MentionVirtualList
        suggestions={suggestions}
        selectionIndex={state.selectionIndex}
        searchQuery={state.searchQuery}
        fromTextArea={fromTextArea}
        isMobile={isMobile}
        getRichWidgetTooltip={getRichWidgetTooltip}
        handleSelection={handleSelection}
        onSuggestionClickRef={onSuggestionClickRef}
        dispatch={dispatch}
        setHovered={setHovered}
        virtualizerScrollRef={virtualizerScrollRef}
      />
    ),
    [
      suggestions,
      state.selectionIndex,
      state.searchQuery,
      fromTextArea,
      isMobile,
      getRichWidgetTooltip,
      handleSelection,
      onSuggestionClickRef,
      dispatch,
      setHovered,
    ],
  );

  return {
    handleRemoveMentionFromText,
    searchSuggestions,
    getRichWidgetTooltip,
    suggestions,
    suggestionElements,
    handleKeyDown,
    handleSelection,
  };
}

type MentionVirtualListProps = {
  suggestions: HierarchicalMention[];
  selectionIndex: number;
  searchQuery: string;
  fromTextArea: boolean;
  isMobile: boolean;
  getRichWidgetTooltip: (
    data: CopilotWidget | HierarchicalMention,
    withTooltip?: boolean,
  ) => React.ReactNode;
  handleSelection: (suggestion: HierarchicalMention) => void;
  onSuggestionClickRef?: MutableRefObject<
    ((suggestion: HierarchicalMention) => void) | null
  >;
  dispatch: (update: Partial<DropdownState>) => void;
  setHovered: (update?: { tabId?: string | null; widgetUuid?: string | null }) => void;
  virtualizerScrollRef: MutableRefObject<((index: number) => void) | null>;
};

const MentionVirtualList = memo((props: MentionVirtualListProps) => {
  const {
    suggestions,
    selectionIndex,
    searchQuery,
    fromTextArea,
    isMobile,
    getRichWidgetTooltip,
    handleSelection,
    onSuggestionClickRef,
    dispatch,
    setHovered,
    virtualizerScrollRef,
  } = props;

  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: suggestions.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 48,
    overscan: 8,
    getItemKey: (index) => suggestions[index]?.id ?? index,
  });

  useEffect(() => {
    virtualizerScrollRef.current = (index) =>
      virtualizer.scrollToIndex(index, { align: "auto" });
    return () => {
      virtualizerScrollRef.current = null;
    };
  }, [virtualizer, virtualizerScrollRef]);

  if (suggestions.length === 0) {
    return (
      <div className="p-4 text-center text-light-500 dark:text-dark-50 text-sm">
        No widgets or tabs found
      </div>
    );
  }

  const prefix = fromTextArea ? "" : "context-";
  const itemClassName = fromTextArea ? "suggestion-item" : "context-suggestion-item";
  const trimmedQuery = searchQuery.trim();

  return (
    <div ref={scrollRef} className="overflow-y-auto max-h-[300px]">
      <div
        style={{
          height: virtualizer.getTotalSize(),
          width: "100%",
          position: "relative",
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const suggestion = suggestions[virtualRow.index];
          if (!suggestion) return null;
          const previousSuggestion = suggestions[virtualRow.index - 1];

          let showDividerAbove = false;
          if (trimmedQuery) {
            if (
              virtualRow.index > 0 &&
              suggestion.group !== previousSuggestion?.group
            ) {
              showDividerAbove = true;
            }
          } else if (virtualRow.index > 0) {
            const prevIsChild = previousSuggestion?._isChildWidget;
            const currentIsChild = suggestion._isChildWidget;
            if (prevIsChild && !currentIsChild && suggestion.group !== "tab") {
              showDividerAbove = true;
            } else if (
              suggestion.group === "all" &&
              previousSuggestion?.group !== "all"
            ) {
              showDividerAbove = true;
            }
          }

          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <MentionSuggestionItem
                suggestion={suggestion}
                index={virtualRow.index}
                isSelected={virtualRow.index === selectionIndex}
                showDividerAbove={showDividerAbove}
                prefix={prefix}
                itemClassName={itemClassName}
                isMobile={isMobile}
                getRichWidgetTooltip={getRichWidgetTooltip}
                handleSelection={handleSelection}
                onSuggestionClickRef={onSuggestionClickRef}
                dispatch={dispatch}
                setHovered={setHovered}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
});

type MentionSuggestionItemProps = {
  suggestion: HierarchicalMention;
  index: number;
  isSelected: boolean;
  showDividerAbove: boolean;
  prefix: string;
  itemClassName: string;
  isMobile: boolean;
  getRichWidgetTooltip: (
    data: CopilotWidget | HierarchicalMention,
    withTooltip?: boolean,
  ) => React.ReactNode;
  handleSelection: (suggestion: HierarchicalMention) => void;
  onSuggestionClickRef?: MutableRefObject<
    ((suggestion: HierarchicalMention) => void) | null
  >;
  dispatch: (update: Partial<DropdownState>) => void;
  setHovered: (update?: { tabId?: string | null; widgetUuid?: string | null }) => void;
};

const MentionSuggestionItem = memo((props: MentionSuggestionItemProps) => {
  const {
    suggestion,
    index,
    isSelected,
    showDividerAbove,
    prefix,
    itemClassName,
    isMobile,
    getRichWidgetTooltip,
    handleSelection,
    onSuggestionClickRef,
    dispatch,
    setHovered,
  } = props;

  const icon = ICON_MAP[suggestion.group] ?? "question-circled-icon";
  const isChildWidget = suggestion._isChildWidget;

  const tooltipMessage = useMemo(
    () => getRichWidgetTooltip(suggestion, false),
    [suggestion, getRichWidgetTooltip],
  );

  return (
    <div className="relative w-full">
      {showDividerAbove && (
        <hr className="w-[calc(100%-0.75rem)] mx-auto h-px border-0 bg-surface-divider" />
      )}
      <Tooltip
        className="min-w-[8rem]"
        key={`${prefix}suggestion-tooltip-${index}`}
        id={`${prefix}suggestion-tooltip-${index}`}
        message={tooltipMessage}
        position="left"
        hide={isMobile}
      >
        <div
          id={`${prefix}suggestion-${index}`}
          className={cn(
            "py-1.5 h-full w-full cursor-pointer",
            itemClassName,
            "hover:bg-general-bg-secondary-hover",
            {
              "px-3": !isChildWidget,
              "px-3 pl-7": isChildWidget,
              "bg-general-bg-secondary-hover": isSelected,
            },
          )}
          onMouseEnter={(e) => {
            e.stopPropagation();
            dispatch({ selectionIndex: index });
            const hoveredUpdate: {
              tabId: string | null;
              widgetUuid: string | null;
            } = { tabId: null, widgetUuid: null };
            if (suggestion.group === "tab" && suggestion.content?.uuid) {
              hoveredUpdate.tabId = suggestion.content.metadata?.innerTabId ?? null;
            } else if (suggestion.content?.uuid) {
              hoveredUpdate.widgetUuid = suggestion.content.uuid;
            }
            setHovered(hoveredUpdate);
          }}
          onMouseLeave={() => setHovered()}
          onClick={(e) => {
            e.stopPropagation();
            if (onSuggestionClickRef?.current)
              return onSuggestionClickRef.current(suggestion);
            handleSelection(suggestion);
          }}
        >
          <WidgetNameItem
            name={suggestion.name}
            description={suggestion.description}
            icon={icon}
            iconClassName={cn("text-dark-50", {
              "text-brand-lighter":
                suggestion.group === "dashboard" || suggestion.group === "tab",
            })}
          />
        </div>
      </Tooltip>
    </div>
  );
});

interface SuggestionElementProps {
  onMouseEnter?: (tabId?: string) => void;
  onMouseLeave?: () => void;
}

interface TabGroupElementProps extends SuggestionElementProps {
  widget: CopilotWidget;
  getAppWidget: (widgetId: WidgetId) => WidgetT | undefined;
  onWidgetMouseEnter?: (widgetUuid?: string) => void;
  onWidgetMouseLeave?: () => void;
}

const TabGroupElement = memo((props: TabGroupElementProps) => {
  const {
    widget,
    getAppWidget,
    onMouseEnter,
    onWidgetMouseEnter,
    onMouseLeave,
    onWidgetMouseLeave,
  } = props;

  const localId = useId();
  const id = widget.uuid || localId;
  const { widgetCount = 0, tabWidgets = [] } = useMemo(
    () => widget.metadata || {},
    [widget.metadata],
  );

  return (
    <div
      key={`tab-tooltip-content-${id}`}
      className="max-w-[320px]"
      onMouseEnter={(e) => {
        e.stopPropagation();
        onMouseEnter?.(widget.metadata?.innerTabId);
      }}
      onMouseLeave={onMouseLeave}
    >
      <div
        className="flex items-center justify-between mb-4"
        onMouseEnter={() => onMouseEnter?.(widget.metadata?.innerTabId)}
      >
        <div className="font-bold text-[12px] leading-[18px] text-light-900 dark:text-white">
          {widget.name}
        </div>
        <span className="text-2xs leading-[1.5] text-[#547280] dark:text-[#7699a8]">
          ({widgetCount} widget{widgetCount !== 1 ? "s" : ""})
        </span>
      </div>

      <div className="max-h-[200px] overflow-y-auto space-y-3">
        {tabWidgets.map((tabWidget, index) => (
          <TabWidgetElement
            key={`tab-widgets-${tabWidget.uuid || localId}-${index}`}
            className="text-xs bg-light-100 dark:bg-dark-700 rounded-sm p-3 transition-colors
            hover:bg-light-200 dark:hover:bg-dark-600"
            index={index}
            tabWidget={tabWidget}
            widgetDefinition={getAppWidget(tabWidget.widget_id as WidgetId)}
            onMouseEnter={onWidgetMouseEnter}
            onMouseLeave={onWidgetMouseLeave}
          />
        ))}
      </div>
    </div>
  );
});

interface TabWidgetElementProps extends SuggestionElementProps {
  tabWidget: CopilotWidget;
  className?: string;
  widgetDefinition?: WidgetT;
  index?: number;
}

export const TabWidgetElement = memo((props: TabWidgetElementProps) => {
  const {
    index = "",
    className = "max-w-[296px]",
    tabWidget,
    widgetDefinition,
    onMouseEnter,
    onMouseLeave,
  } = props;
  const localId = useId();
  const id = tabWidget.uuid || localId;

  const widgetInfo = useMemo(() => {
    const widgetId = tabWidget.widget_id || "";

    const title = tabWidget.name || widgetId || "Unnamed widget";
    const description = tabWidget.description || "";
    const category = widgetDefinition?.category || "";

    const backend = widgetDefinition?.external
      ? widgetDefinition?.connectionType === "advanced-backend"
        ? widgetDefinition?.sourceName || "Unknown"
        : "Workspace API"
      : tabWidget.origin || "Workspace";

    const subCategory = widgetDefinition?.subCategory || "";
    const source = widgetDefinition?.source || "";

    return {
      title,
      description,
      category,
      subCategory,
      backend,
      source,
    };
  }, [tabWidget, widgetDefinition]);

  return (
    <div
      key={`tab-widget-${id}-${index}`}
      className={className}
      onMouseEnter={(e) => {
        e.stopPropagation();
        onMouseEnter?.(tabWidget.uuid);
      }}
      onMouseLeave={onMouseLeave}
    >
      <div className="flex justify-between items-center gap-2 mb-2.5 min-w-0">
        <Tooltip message={widgetInfo.backend} position="top">
          <div className="bg-[rgba(188,188,188,0.3)] dark:bg-[rgba(90,89,97,0.3)] rounded-xl min-w-0 max-w-[140px]">
            <div className="px-1.5 py-0">
              <span className="block truncate whitespace-nowrap text-2xs leading-[1.5] text-light-600 dark:text-dark-50">
                {widgetInfo.backend}
              </span>
            </div>
          </div>
        </Tooltip>
        {widgetInfo.source && (
          <Tooltip message={widgetInfo.source} position="top">
            <span className="block truncate whitespace-nowrap min-w-0 max-w-[140px] text-2xs leading-[1.5] text-[#547280] dark:text-[#7699a8]">
              {widgetInfo.source}
            </span>
          </Tooltip>
        )}
      </div>

      <div className="font-bold text-[12px] leading-[18px] text-light-900 dark:text-white mb-2">
        {widgetInfo.title}
      </div>

      <hr className="border-light-200 dark:border-dark-400 mb-2" />

      {(widgetInfo.category || widgetInfo.subCategory) && (
        <div className="text-2xs leading-[1.5] text-[#547280] dark:text-[#7699a8] mb-1">
          {[widgetInfo.category, widgetInfo.subCategory].filter(Boolean).join(" • ")}
        </div>
      )}

      {widgetInfo.description && (
        <div className="text-[12px] leading-[18px] text-dark-900 dark:text-white mt-2 max-h-[150px] overflow-y-auto">
          {widgetInfo.description}
        </div>
      )}
    </div>
  );
});

const ICON_MAP = {
  all: "file-plus-03",
  dashboard: "file-check-03",
  web: "globe-01",
  sec: "search-refraction",
  tab: "folder-closed",
} as const;

type Action = (uuid: string) => void;

interface DropdownState {
  searchQuery: string;
  suggestions: HierarchicalMention[];
  selectionIndex: number;
  isDropdownOpen: boolean;
  pendingSelection: boolean;
}

export const highlightSelection = (index: number, fromTextArea = false) => {
  const allElements = document.getElementsByClassName(
    `${fromTextArea ? "" : "context-"}suggestion-item`,
  );
  for (let i = 0; i < allElements.length; i++) {
    const el = allElements[i] as HTMLElement;
    el?.classList?.toggle("bg-light-100", i === index);
    el?.classList?.toggle("dark:bg-dark-500", i === index);
  }
};

export const scrollToSuggestion = (index: number, fromTextArea = false) => {
  const element = document.getElementById(
    `${fromTextArea ? "" : "context-"}suggestion-${index}`,
  );
  element?.scrollIntoView?.({
    block: "nearest",
    behavior: "instant",
    inline: "nearest",
  });

  highlightSelection(index, fromTextArea);
};

export function getSelectionIndex(fromTextArea: boolean) {
  const allElements = document.getElementsByClassName(
    `${fromTextArea ? "" : "context-"}suggestion-item`,
  );
  for (let i = 0; i < allElements.length; i++) {
    const el = allElements[i] as HTMLElement;
    if (
      el?.classList?.contains("bg-light-100") &&
      el?.classList?.contains("dark:bg-dark-500")
    ) {
      return i;
    }
  }

  return 0;
}

const verifySuggestionIntegrity = (suggestion: Mention) => {
  if (!suggestion.content) return false;
  if (suggestion.group === "all" && !suggestion.content.uuid) {
    if (!suggestion.content.widget_id) return false;
    return true;
  }
  if (!suggestion.content.uuid) return false;
  return true;
};

function isTabSelectedFn(selectedTabUuids: Set<string>) {
  return (suggestion: Mention) =>
    suggestion.content?.uuid && selectedTabUuids.has(suggestion.content.uuid);
}

function isTabFullySelectedFn(selectedWidgetUuids: Set<string>) {
  return (tabSuggestion: Mention) => {
    const tabWidgets = tabSuggestion.content?.metadata?.tabWidgets || [];
    if (tabWidgets.length === 0) return false;

    return tabWidgets.every(
      (tabWidget) => tabWidget.uuid && selectedWidgetUuids.has(tabWidget.uuid),
    );
  };
}

function isParentTabSelectedFn(
  filteredByType: Mention[],
  selectedTabUuids: Set<string>,
) {
  return (widgetUuid: string) => {
    const parentTab = filteredByType.find((suggestion) => {
      if (suggestion.group !== "tab") return false;
      const tabWidgets = suggestion.content?.metadata?.tabWidgets || [];
      return tabWidgets.some((tabWidget) => tabWidget.uuid === widgetUuid);
    });

    if (!parentTab?.content?.uuid) return false;
    return selectedTabUuids.has(parentTab.content.uuid);
  };
}

function addTabChildWidgetUuidsFn(tabChildWidgetUuids: Set<string>) {
  return (copilotWidget: CopilotWidget) => {
    const tabWidgets = copilotWidget?.metadata?.tabWidgets || [];
    for (const tabWidget of tabWidgets)
      if (tabWidget.uuid) tabChildWidgetUuids.add(tabWidget.uuid);
  };
}

function getSuggestionInfo(suggestion: CopilotWidget | HierarchicalMention) {
  if ("content" in suggestion && suggestion.content) {
    return {
      widget: suggestion.content,
      name: suggestion.content?.name || suggestion.name,
      isTab: suggestion.group === "tab",
      isMention: true,
    } as const;
  }

  const widget = suggestion as CopilotWidget;

  return {
    widget: widget,
    name: widget.name,
    isTab: widget.widget_id?.startsWith("tab_"),
    isMention: false,
  } as const;
}

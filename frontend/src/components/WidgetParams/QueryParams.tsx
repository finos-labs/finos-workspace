import { type UseQueryOptions, useQueries } from "@tanstack/react-query";
import isEqual from "lodash.isequal";
import {
  type MutableRefObject,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { toast } from "sonner";
import { FormParamElement } from "~/components/DraggableCard/FormParamDef";
import { Button } from "~/components/ds/atoms/Button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "~/components/ds/atoms/DropdownMenu";
import { AdvancedSelect, type TSelectValues } from "~/components/NewAdvancedSelect";
import { ToggleSelect } from "~/components/ToggleSelect";
import type { ParamDef, ParamDefT, StoredParamValue } from "~/components/types";
import DebouncedInput from "~/components/ui/DebouncedInput";
import { SingleDatePicker } from "~/components/ui/SingleDatePicker";
import { useWidgetContext } from "~/components/Widget.context";
import GroupDropdown from "~/components/Widgets/Helpers/GroupDropdown";
import { useParamGroupBindings } from "~/components/Widgets/Helpers/useParamGroupBindings";
import { useIsFirstRender } from "~/hooks/useIsFirstRender";
import { useStateReducer } from "~/hooks/useStateReducer";
import { useSourceCredentials } from "~/lib/state/backendConnector";
import { useShallowCopilotDataStore } from "~/lib/state/copilotData";
import {
  beautifySlug,
  cn,
  createParamDefs,
  endpointOptionsRequest,
  endpointParamDependsOnAnotherParam,
  ensureArray,
  ensureString,
  getDependentEndpointParamValues,
  getJsonWidget,
  getOfferedEndpointParamValue,
  getUngroupedDependentEndpointParams,
  triggerCustomEvent,
  useEventListener,
} from "~/lib/utils";
import { someTruthy } from "~/lib/utils/values";
import {
  RequestProblemsError,
  requestInit,
  requestKey,
} from "~/lib/utils/widgetRequest";
import CompareTermsParam from "./CompareTermsParam";
import { TabsParam } from "./TabsParam";

/** A form of the widget, opened from a button named by the form's label. */
export function FormParamDialog({ formParamDef }: { formParamDef: ParamDefT<"form"> }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild={true}>
        <Button size="xs" variant="outlined" className="h-[20px]">
          {formParamDef.label ?? "Open Form"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-[320px] max-w-[600px] max-h-[600px] overflow-y-auto z-10"
        side="bottom"
        align="start"
      >
        <FormParamElement formParamDef={formParamDef} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type ParamsT = Record<string, StoredParamValue>;

type ParamsStateT = { localParams: ParamsT };

/** What a select holds of a parameter's value: the values themselves, none empty. */
function toSelected(
  value: StoredParamValue | undefined,
): string | number | boolean | (string | number | boolean)[] | undefined {
  if (Array.isArray(value)) {
    return value.filter((v): v is string | number | boolean => v !== null);
  }
  return value ?? undefined;
}

function replaceFailed(
  selected: StoredParamValue | undefined,
  localValue?: StoredParamValue,
) {
  if (selected === "Failed to fetch options") return localValue;
  return selected;
}

export function useWidgetParamsPositions(enabled = true) {
  const { widget, updateWidget } = useWidgetContext();
  // The option endpoints are called with the source's credentials, read when they run
  const credentials = useSourceCredentials(widget.sourceId, widget.endpoint?.url);
  const { setWidgetCopilotDraftParams, beginWidgetCopilotExecution } =
    useShallowCopilotDataStore((s) => ({
      setWidgetCopilotDraftParams: s.setWidgetCopilotDraftParams,
      beginWidgetCopilotExecution: s.beginWidgetCopilotExecution,
    }));

  const params: ParamsT = widget?.storage?.params ?? {};

  const [state, dispatch] = useStateReducer<ParamsStateT>({
    localParams: params,
  });

  const currentParamsRef = useRef<ParamsT>(params);
  const invalidResponseRef = useRef<Record<string, boolean>>({});

  useEffect(() => {
    if (isEqual(currentParamsRef.current, params)) return;

    currentParamsRef.current = params;
    dispatch({
      localParams: (prev) => (isEqual(prev, params) ? prev : params),
    });
  }, [params, dispatch]);

  const syncCopilotParamsState = useCallback(
    (draftParams: ParamsT, executedParams: ParamsT = {}) => {
      setWidgetCopilotDraftParams(widget.id, { ...executedParams, ...draftParams });
    },
    [setWidgetCopilotDraftParams, widget.id],
  );

  const { updateGroupedParam } = useParamGroupBindings();

  const { formParams, paramsGroupedByRow, endpointParams, hasParams, tabsParams } =
    useMemo(() => {
      const endpointParams = {} as Record<string, ParamDefT<"endpoint">>;
      const paramsGroupedByRow: Record<number, ParamDef[]> = {};
      const tabsParams: ParamDefT<"tabs">[] = [];
      const formParams: ParamDefT<"form">[] = [];
      let hasParams = false;
      const widgetJSON = getJsonWidget(widget);

      const widgetParams = createParamDefs(widgetJSON ?? {});
      const paramGroups = widget?.paramGroups ?? {};
      const badgeParams = new Set(
        Object.keys(paramGroups).filter((groupId) => paramGroups[groupId]),
      );
      let maxRows = 0;

      for (const param of widgetParams) {
        const isHiddenBadgeParam =
          !param?.show &&
          (badgeParams.has(param.paramName) ||
            (param.type === "endpoint" &&
              param.groupById !== undefined &&
              badgeParams.has(param.groupById)));

        if (param?.type === "form") {
          formParams.push(param);
          continue;
        }
        // Collect tabs params separately - they render in their own row below navbar
        if (param?.type === "tabs") {
          tabsParams.push(param);
          hasParams = true;
          continue;
        }

        if (param?.show || isHiddenBadgeParam) {
          if (param?.show && param?.type === "endpoint")
            endpointParams[param.paramName] = param;

          // Group parameters by their row number (default to 0 if not specified)
          const rowNumber = param.row ?? 0;
          if (!paramsGroupedByRow[rowNumber]) {
            paramsGroupedByRow[rowNumber] = [];
          }
          paramsGroupedByRow[rowNumber].push(param);
          maxRows = Math.max(maxRows, rowNumber);
          hasParams = true;
        }
      }

      // Ensure all rows up to maxRows are present
      for (let i = 0; i <= maxRows; i++)
        !paramsGroupedByRow[i] && (paramsGroupedByRow[i] = []);

      return {
        paramsGroupedByRow,
        endpointParams,
        formParams,
        hasParams,
        tabsParams,
      };
    }, [widget?.paramGroups, widget?.params]);

  const syncParams = useCallback(
    (props?: { params?: ParamsT }) => {
      const localParams = props?.params ?? state.localParams;
      const params = currentParamsRef.current;
      const nextExecutedParams = { ...params, ...localParams };

      if (Object.keys(localParams).every((key) => params[key] === localParams[key])) {
        if (!widget.runButton) return;
        beginWidgetCopilotExecution(widget.id, nextExecutedParams);
        return updateWidget((prev) => ({ ...prev, refreshQuery: Date.now() }));
      }
      triggerCustomEvent(`staleParams-${widget?.id}`, false);
      currentParamsRef.current = nextExecutedParams;
      syncCopilotParamsState(nextExecutedParams);
      beginWidgetCopilotExecution(widget.id, nextExecutedParams);

      updateWidget((prev) => {
        const newWidget = { ...prev };
        newWidget.storage = {
          ...newWidget.storage,
          params: {
            ...(newWidget?.storage?.params ?? {}),
            ...localParams,
          },
        };

        return newWidget;
      });
    },
    [
      updateWidget,
      state,
      currentParamsRef,
      syncCopilotParamsState,
      beginWidgetCopilotExecution,
    ],
  );

  const syncParamsRef = useRef(syncParams);

  useEffect(() => {
    syncParamsRef.current = syncParams;
  }, [syncParams]);

  const updateParams = useCallback(
    (key: string, value: StoredParamValue) => {
      const updatedGroupedParam = updateGroupedParam(key, value);

      // A param whose options depend on this one (the feeds of a provider) can hold a value
      // that the new value does not offer. It takes the offered one before the widget loads.
      const hasDependents =
        !updatedGroupedParam &&
        getUngroupedDependentEndpointParams(widget, key).length > 0;

      if (!widget.runButton && !updatedGroupedParam && !hasDependents) {
        syncParamsRef.current({ params: { [key]: value } });
      }

      if (hasDependents) {
        const nextParams = { ...currentParamsRef.current, [key]: value };
        getDependentEndpointParamValues(widget, key, nextParams)
          .catch((error) => {
            console.error("Failed to update the dependent parameters", error);
            return {} as ParamsT;
          })
          .then((dependentValues) => {
            if (!widget.runButton) {
              syncParamsRef.current({ params: { [key]: value, ...dependentValues } });
            }
            dispatch({
              localParams: (prev) => ({ ...prev, [key]: value, ...dependentValues }),
            });
          });
      }

      dispatch({
        localParams: (prev) => {
          const localParams = { ...prev, [key]: value };
          if (widget.runButton) {
            const params = currentParamsRef.current;
            const staleParams = Object.keys(localParams).some(
              (paramKey) => params?.[paramKey] !== localParams[paramKey],
            );
            queueMicrotask(() => {
              triggerCustomEvent(`staleParams-${widget?.id}`, staleParams);
              syncCopilotParamsState(localParams, params);
            });
          }
          return localParams;
        },
      });
    },
    [
      dispatch,
      widget?.runButton,
      syncParamsRef,
      currentParamsRef,
      syncCopilotParamsState,
      updateGroupedParam,
      widget,
    ],
  );

  const queriesMemo = useMemo(() => {
    const queries = Object.values(endpointParams).map((param) => {
      const built = endpointOptionsRequest(widget, param, state.localParams);

      return {
        queryKey: [
          "endpoint_options",
          param.groupById,
          ...(built ? requestKey(built) : []),
        ],
        queryFn: async ({ signal }) => {
          if (!built) return [];
          if (!built.ok) throw new RequestProblemsError(built.problems);
          const res = await fetch(
            built.request.url,
            requestInit(built.request, { signal, credentials: "omit" }),
          );
          if (res.ok) {
            return await res.json();
          }
          throw new Error(res.statusText);
        },
        enabled: enabled && !!built,
        refetchOnWindowFocus: false,
        staleTime: 1000 * 60 * 60,
      } as UseQueryOptions<(TSelectValues | string)[]>;
    });

    return { queries };
  }, [
    endpointParams,
    widget.endpoint,
    widget.params,
    widget.sourceId,
    credentials,
    state.localParams,
    widget.refreshQuery,
  ]);

  const endpointQueries = useQueries(queriesMemo);
  const isFirstRender = useIsFirstRender();

  useEffect(() => {
    if (isFirstRender) return;
    queueMicrotask(() => {
      for (const query of endpointQueries) {
        if (query.isLoading || query.isFetching) continue;
        query.refetch();
      }
    });
  }, [widget.refreshQuery]);

  const endpointOptions = useMemo(() => {
    const paramKeys = Object.keys(endpointParams);
    return endpointQueries.reduce(
      (acc, query, idx) => {
        if (query.isLoading) return acc;
        const key = paramKeys[idx];
        if (query.isError) {
          console.error("Failed to fetch endpoint options", query.error);

          acc[key] = ["Failed to fetch options"];
          return acc;
        }

        invalidResponseRef.current[key] = false;
        acc[key] = query.data ?? [];

        return acc;
      },
      {} as Record<string, (TSelectValues | string)[]>,
    );
  }, [endpointQueries, endpointParams, invalidResponseRef]);

  // A value saved with another provider (a dashboard from before, a backend whose feeds
  // changed) that the options no longer offer would make the widget load nothing: take the
  // offered one. Params in a group follow their group.
  useEffect(() => {
    if (!enabled || widget.runButton) return;

    const fixes: ParamsT = {};
    Object.values(endpointParams).forEach((param, idx) => {
      const query = endpointQueries[idx];
      if (param.groupById !== undefined && widget.paramGroups?.[param.groupById])
        return;
      if (!endpointParamDependsOnAnotherParam(param)) return;
      if (!query?.isSuccess || !Array.isArray(query.data) || query.data.length === 0) {
        return;
      }

      const offered = getOfferedEndpointParamValue(
        param,
        query.data,
        state.localParams[param.paramName],
      );
      if (offered !== undefined) fixes[param.paramName] = offered;
    });

    if (Object.keys(fixes).length === 0) return;
    syncParamsRef.current({ params: fixes });
    dispatch({ localParams: (prev) => ({ ...prev, ...fixes }) });
  }, [endpointQueries]);

  useEventListener(`runParams-${widget?.id}`, () => widget.runButton && syncParams());

  useEventListener(`updateQueryParams-${widget?.id}`, (newParams: ParamsT) => {
    if (!(Object.keys(newParams || {}).length && hasParams)) return;
    queueMicrotask(() => {
      dispatch({
        localParams: (prev) => {
          const nextLocalParams = { ...prev, ...newParams };
          if (widget.runButton) {
            const params = currentParamsRef.current;
            queueMicrotask(() => syncCopilotParamsState(nextLocalParams, params));
          }
          return nextLocalParams;
        },
      });
    });
  });

  const { rowElements, tabRowElements } = useMemo(() => {
    const rowElements = Object.values(paramsGroupedByRow).map((rowParams, index) => {
      if (!rowParams?.length) return null;

      const element = (
        <RenderParamsForRow
          key={`param-row-${index}-render`}
          rowParams={rowParams}
          state={state}
          updateParams={updateParams}
          endpointOptions={endpointOptions}
          endpointParams={endpointParams}
          invalidResponseRef={invalidResponseRef}
          isExternal={widget.external}
        />
      );
      if (index === 0) return element;

      return (
        <div
          key={`param-row-${index}`}
          className="flex gap-1.5 mx-2.5 pb-1 overflow-y-hidden overflow-x-auto h-[22px] text-2xs"
        >
          {element}
        </div>
      );
    });

    const tabRowElements =
      tabsParams.length > 0 ? (
        <RenderTabParamsRow
          tabsParams={tabsParams}
          state={state}
          updateParams={updateParams}
        />
      ) : null;

    return { rowElements, tabRowElements };
  }, [
    paramsGroupedByRow,
    state,
    endpointOptions,
    updateParams,
    endpointParams,
    tabsParams,
    invalidResponseRef,
  ]);

  // Return the row 0 parameters to be used in elementRightNextToTitle
  return useMemo(() => {
    const [row0, ...rowsBelow] = rowElements;

    const renderRow0Params = (
      <div
        data-widget-param-row="0"
        className="flex gap-1.5 _elements-left-navbar
        min-w-fit items-center h-[22px] text-2xs"
      >
        {formParams.map((formParam) => (
          <FormParamDialog
            key={[formParam.paramName, formParam.label, formParam.endpoint].join("|")}
            formParamDef={formParam}
          />
        ))}
        {row0}
      </div>
    );

    // Render tabs params in their own row below the navbar
    const renderTabsRow = tabRowElements ? (
      <div className="flex items-center gap-2 px-2.5 py-1">{tabRowElements}</div>
    ) : null;

    const filteredRowsBelow = rowsBelow.filter(Boolean);
    const hasRowsBelow = filteredRowsBelow.length > 0 || renderTabsRow;

    if (!someTruthy(row0, hasRowsBelow, formParams.length > 0))
      return { renderRow0Params: null, renderBelowNavbarRows: null };

    if (!hasRowsBelow) return { renderRow0Params, renderBelowNavbarRows: null };

    const renderBelowNavbarRows = (
      <div className="flex flex-col gap-1 my-1">
        {filteredRowsBelow}
        {renderTabsRow}
      </div>
    );

    return { renderRow0Params, renderBelowNavbarRows };
  }, [rowElements, tabRowElements, formParams]);
}

const RenderTabParamsRow = memo(
  (props: {
    tabsParams: ParamDefT<"tabs">[];
    state: ParamsStateT;
    updateParams: (key: string, value: StoredParamValue) => void;
  }) => {
    const { tabsParams, state, updateParams } = props;
    return tabsParams.map((param, index) => {
      const { paramName, label, options } = param;
      const localValue = state.localParams?.[paramName] ?? param.value;

      const title = label ?? paramName;
      const toolTipMessage = (
        <div className="max-w-[296px]">
          <div className="flex justify-between gap-2">
            <div className="body-sm-bold break-words line-clamp-2">{title}</div>
          </div>
          {typeof param.description === "string" && (
            <div className="body-xs-regular pt-2 break-words max-h-[296px] overflow-y-auto">
              {param.description}
            </div>
          )}
        </div>
      );

      return (
        <TabsParam
          key={`tabs-param-${index}`}
          value={ensureString(localValue)}
          options={options}
          onValueChange={(value) => updateParams(paramName, value)}
          toolTipMessage={toolTipMessage}
        />
      );
    });
  },
);

export const RenderParamsForRow = memo(
  (props: {
    rowParams: ParamDef[];
    state: ParamsStateT;
    updateParams: (key: string, value: StoredParamValue) => void;
    endpointParams?: Record<string, ParamDefT<"endpoint">>;
    endpointOptions?: Record<string, (TSelectValues | string)[]>;
    invalidResponseRef: MutableRefObject<Record<string, boolean>>;
    isExternal?: boolean;
  }) => {
    const {
      rowParams,
      state,
      updateParams,
      endpointOptions,
      endpointParams,
      invalidResponseRef,
      isExternal = false,
    } = props;

    return rowParams.map((param) => {
      const {
        paramName,
        label,
        options: defaultOptions,
        description = [],
        multiSelect = false,
      } = param;

      const localValue = state.localParams?.[paramName] ?? param.value;

      if (!param.show) {
        return (
          <GroupDropdown
            className=""
            paramDef={param}
            key={`${paramName}-${param.row}`}
          />
        );
      }

      const title = label ?? paramName;
      let options: TSelectValues[] = defaultOptions ?? [];

      const toolTipMessage = (
        <div className="max-w-[296px]">
          <div className="flex justify-between gap-2">
            <div className="body-sm-bold break-words line-clamp-2">{title}</div>
          </div>
          {typeof description === "string" && (
            <div className="body-xs-regular pt-2 break-words max-h-[296px] overflow-y-auto">
              {description.split(/\n|\\\n/).map((line, idx) => {
                // Count leading spaces for indentation
                const spaces = line.match(/^ */)?.[0].length ?? 0;
                return (
                  <div
                    key={`${paramName}-desc-${idx}`}
                    className={cn(`pl-${Math.min(6, spaces)}`)}
                  >
                    {line}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      );
      if (param.type === "boolean" && options?.length === 2) {
        const stringParam = state.localParams?.[paramName]?.toString();
        return (
          <GroupDropdown
            className="ws-parameter pr-0.5"
            type="param"
            paramDef={param}
            key={`${paramName}-${param.row}`}
          >
            <ToggleSelect
              className="w-fit min-w-[96px]"
              label={beautifySlug(title)}
              selected={stringParam?.toLowerCase() === "true"}
              onSelect={(selected) =>
                updateParams(paramName, selected ? "true" : "false")
              }
              values={[
                { label: "On", value: true },
                { label: "Off", value: false },
              ]}
              toolTipMessage={toolTipMessage}
            />
          </GroupDropdown>
        );
      }

      if (param.type === "date") {
        return (
          <GroupDropdown
            className="ws-parameter pr-0.5"
            type="param"
            paramDef={param}
            key={`${paramName}-${param.row}`}
          >
            <SingleDatePicker
              triggerClassName=""
              key={`${paramName}-${param.row}-tooltip`}
              defaultDate={localValue as string}
              onSave={(date) => {
                const formattedDate = date ? date : "";
                updateParams(paramName, formattedDate);
              }}
              toolTipProps={{
                message: toolTipMessage,
                position: "top",
              }}
            />
          </GroupDropdown>
        );
      }

      let forceExtraInfo = false;
      if (param.type === "endpoint") {
        let paramOptions = endpointOptions?.[paramName] ?? ["Loading..."];
        if (!Array.isArray(paramOptions)) {
          const showWarning = !invalidResponseRef.current[paramName];

          if (showWarning) {
            const cleanUrl = endpointParams?.[paramName]?.optionsEndpoint
              ?.split("/")
              .pop();
            toast.warning("Invalid response for endpoint params.", {
              id: `invalid-endpoint-${cleanUrl}`,
              description: (
                <>
                  Invalid endpoint options structure for{" "}
                  <span className="font-bold">{cleanUrl}</span>.
                  <div className="pt-2">
                    <strong>Expected array of:</strong>
                    <br />
                    <div className="text-xs pl-4">
                      Strings or Objects with <strong>label</strong> and{" "}
                      <strong>value</strong> properties.
                    </div>
                  </div>
                </>
              ),
            });

            invalidResponseRef.current[paramName] = true;
          }
          paramOptions = ["Invalid endpoint options"];
        }
        options = paramOptions
          .map((option: TSelectValues | string) => {
            if (Array.isArray(option)) return null;

            if (typeof option !== "object") {
              const label = option?.toString();
              return { label, value: option };
            }

            if (option) {
              if (option?.label && option?.value) return option;

              const lowerOption = Object.fromEntries(
                Object.entries(option).map(([key, value]) => [
                  key.toLowerCase(),
                  value,
                ]),
              ) as TSelectValues;

              if (lowerOption?.label && lowerOption?.value) return lowerOption;
            }

            return null;
          })
          .filter((option): option is TSelectValues => Boolean(option))
          // Float null/empty rows to the top so they don't sit awkwardly
          // between real values.
          .sort((a, b) => {
            const aEmpty = a.value === null || a.value === undefined || a.value === "";
            const bEmpty = b.value === null || b.value === undefined || b.value === "";
            if (aEmpty === bEmpty) return 0;
            return aEmpty ? -1 : 1;
          });

        forceExtraInfo = options.some((o) => o?.extraInfo);
      }

      if (param.multiple) {
        return (
          <GroupDropdown
            paramDef={param}
            type="param"
            key={`${paramName}-${param.row}`}
          >
            <CompareTermsParam
              className=""
              toolTipMessage={toolTipMessage}
              selectedLabel={param.label ?? paramName}
              popupWidth={param.style?.popupWidth}
              value={ensureString(localValue)}
              onUpdateParam={(val) => updateParams(paramName, val)}
            />
          </GroupDropdown>
        );
      }

      if (options.length > 0) {
        const selectedLabel =
          options.find((o) => o.value === localValue)?.label ?? title;
        const selectedValue = toSelected(localValue);
        const selectedList = ensureArray<string | number | boolean>(
          selectedValue ?? [],
        );
        return (
          <GroupDropdown
            paramDef={param}
            type={param.type === "endpoint" ? "endpointParam" : "param"}
            key={`${paramName}-${param.row}`}
          >
            <AdvancedSelect
              className=""
              popupWidth={param.style?.popupWidth}
              key={`${paramName}-${param.row}`}
              label={
                multiSelect ? (selectedList.length > 0 ? title : "") : selectedLabel
              }
              selected={multiSelect ? selectedList : selectedValue}
              onSelect={(option) => {
                const value = replaceFailed(option, localValue);
                if (value !== undefined) updateParams(paramName, value);
              }}
              values={options}
              toolTipMessage={toolTipMessage}
              forceSearch={param.type === "endpoint" || options.length > 10}
              forceExtraInfo={forceExtraInfo}
            />
          </GroupDropdown>
        );
      }

      return (
        <GroupDropdown type="param" paramDef={param} key={`${paramName}-${param.row}`}>
          <DebouncedInput
            key={`${paramName}-${param.row}-input`}
            type={param.type}
            className={cn(
              "ws-minimal-input bg-transparent dark:bg-transparent px-0 h-[18.8px]! border-none!",
              param.type !== "number" &&
                param.type !== "text" &&
                "w-[96px] min-w-[96px]",
            )}
            placeholder={label ?? paramName}
            value={localValue as string}
            debounce={1250}
            onChange={(value) => updateParams(paramName, value)}
            sizeToContent={
              isExternal || param.type === "number" || param.type === "text"
            }
            toolTipProps={{
              message: toolTipMessage,
              position: "top",
            }}
          />
        </GroupDropdown>
      );
    });
  },
);

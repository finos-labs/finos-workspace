import { useCallback, useMemo } from "react";
import { DataTable, type DataTableColumn } from "~/components/ds/molecules/DataTable";
import Icon from "~/components/Icon";
import Tooltip from "~/components/Tooltip";
import type { WidgetT } from "~/components/types";
import { useWidgetContext } from "~/components/Widget.context";
import { type QueryOptions, useJsonData } from "~/lib/api";
import { useSourceCredentials } from "~/lib/state/backendConnector";
import { useShallowThemeStore } from "~/lib/state/theme";
import { cn } from "~/lib/utils";
import { rowsOf } from "~/lib/utils/rawRows";
import { buildWidgetRequest, requestKey } from "~/lib/utils/widgetRequest";

export function useRawRows(widget: WidgetT) {
  const theme = useShallowThemeStore((state) => state.theme);
  const credentials = useSourceCredentials(widget.sourceId, widget.endpoint?.url);
  const hasRaw = widget.raw === true;
  const rawDataKey = widget.data?.rawDataKey;
  const options = useMemo<QueryOptions>(() => {
    const request = hasRaw
      ? buildWidgetRequest(widget, credentials, {
          theme: theme === "light" ? "light" : "dark",
          raw: "true",
        })
      : null;
    return {
      request,
      responseCb: async (response, resolve) => {
        resolve(rowsOf(await response.json(), rawDataKey));
      },
      queryKey:
        widget.runButton && request
          ? ["raw", widget.id, ...requestKey(request), widget.refreshQuery ?? 0]
          : undefined,
    };
  }, [
    hasRaw,
    rawDataKey,
    widget.id,
    widget.runButton,
    widget.refreshQuery,
    widget.endpoint,
    widget.params,
    widget.storage?.params,
    theme,
    credentials,
  ]);
  return useJsonData<unknown>(options, {
    enabled: hasRaw,
    staleTime: widget.staleTime ?? 1000 * 60 * 15,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
    retryDelay: 1000,
  });
}

export function useRowsView(): [boolean, (on: boolean) => void] {
  const { widget, updateWidget } = useWidgetContext();
  const showRows = widget.raw === true && widget.storage?.rawDataView === true;
  const setShowRows = useCallback(
    (on: boolean) =>
      updateWidget((prev) => ({
        ...prev,
        storage: { ...prev.storage, rawDataView: on },
      })),
    [updateWidget],
  );
  return [showRows, setShowRows];
}

export function RowsToggle(props: {
  showRows: boolean;
  onChange: (on: boolean) => void;
  viewName: string;
}) {
  const { showRows, onChange, viewName } = props;
  const label = showRows ? `Switch to ${viewName} view` : "Switch to raw data view";
  return (
    <Tooltip message={label}>
      <button
        type="button"
        onClick={() => onChange(!showRows)}
        className={cn("ws-small-navbar-btn", {
          "bg-brand-main! text-white! hover:bg-brand-main!": showRows,
        })}
        aria-label={label}
        aria-pressed={showRows}
        id="raw-data-toggle-button"
      >
        <Icon id="database-icon" className="h-3.5 w-3.5" />
      </button>
    </Tooltip>
  );
}

type Row = Record<string, unknown>;

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function RowsTable({ rows }: { rows: unknown }) {
  const list = useMemo(
    () =>
      Array.isArray(rows)
        ? rows.filter(
            (row): row is Row =>
              !!row && typeof row === "object" && !Array.isArray(row),
          )
        : [],
    [rows],
  );
  const columns = useMemo<DataTableColumn<{ id: string; row: Row }>[]>(() => {
    const keys = [...new Set(list.flatMap((row) => Object.keys(row)))];
    return keys.map((key) => ({
      id: key,
      header: key,
      width: "auto",
      minWidth: 96,
      cell: ({ row }) => cellText(row[key]),
    }));
  }, [list]);
  if (!list.length)
    return (
      <pre className="h-full w-full overflow-auto p-2 body-xs-regular">
        {rows === undefined ? "" : JSON.stringify(rows, null, 2)}
      </pre>
    );
  return (
    <div className="h-full w-full overflow-auto px-2" data-testid="raw-rows-table">
      <DataTable
        columns={columns}
        data={list.map((row, index) => ({ id: String(index), row }))}
        getRowId={(item) => item.id}
        rowGap={0}
      />
    </div>
  );
}

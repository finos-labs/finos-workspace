import cloneDeep from "lodash/cloneDeep";
import { useMemo, useState } from "react";
import CodeSnippet from "~/components/CodeSnippet";
import { docsUrl } from "~/lib/docsUrl";
import { useShallowAccessStore } from "~/lib/state/access";
import type { Widget } from "~/lib/state/app";
import { cn } from "~/lib/utils";
import { showNotification } from "~/lib/utils/toast";
import { Button } from "./ds/atoms/Button";
import { Checkbox } from "./ds/atoms/Checkbox";
import { BaseDialog } from "./ds/dialogs/BaseDialog";
import { DialogDescription, DialogTitle } from "./ds/dialogs/Dialog";
import Icon from "./Icon";
import { useWidgetContext } from "./Widget.context";

const excelDocsHref = docsUrl("excel");

type FunctionFormat = {
  display: string;
  copy: string;
  explicitParamsCopy?: string;
  explicitParamsDisplay?: string;
};

const compact = (values: (string | null | undefined)[]): string[] =>
  values.filter((value): value is string => !!value);

export function getFunc(functionName: string, widget: Widget): FunctionFormat {
  const functionNameExcel = functionName.replace("WORKSPACE.", "").toUpperCase();

  const funcs = functionName;

  const storageParams = cloneDeep(widget.storage?.params || {});
  const widgetPrefix = widget.widgetId?.split("-")[0];

  for (const p of widget?.params || []) {
    const paramValue = storageParams[p.paramName];
    if (
      p.type === "number" &&
      typeof paramValue === "string" &&
      !Number.isNaN(Number(paramValue))
    ) {
      storageParams[p.paramName] = Number(paramValue);
    }
  }

  const formatParamValue = (value: unknown): string | number => {
    if (value === undefined || value === null || value === "") return "";
    if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
    if (typeof value === "number") return value;
    return `"${value}"`;
  };

  const getSingleLineFormat = (params: string[]): string => {
    return `=${funcs}(${params.filter(Boolean).join(",")})`;
  };

  const getDisplayFormat = (params: string[]): string => {
    const filteredParams = params.filter(Boolean);
    if (filteredParams.length <= 2) {
      return getSingleLineFormat(filteredParams);
    }
    const [first, second, ...rest] = filteredParams;
    const restParams = rest[0]
      ?.slice(1, -1)
      .split(";")
      .map((p) => p.trim())
      .filter(Boolean)
      .join(";\n      ");
    return `=${funcs}(\n   ${first},\n   ${second},\n   {\n      ${restParams}\n   })`;
  };

  const getExplicitParamsFormat = (
    widget: Widget,
    params: Record<string, unknown>,
  ): { display: string; copy: string } => {
    // Filter out empty values and metadata objects
    const filteredParams = Object.fromEntries(
      Object.entries(params).filter(([_, value]) => {
        // Skip if value is a metadata object (has value property)
        if (typeof value === "object" && value !== null && "value" in value) {
          return false;
        }
        const formattedValue = formatParamValue(value);
        return (
          formattedValue !== "" &&
          formattedValue !== '""' &&
          formattedValue !== '""' &&
          !(Array.isArray(value) && value.length === 0)
        );
      }),
    );

    // Find the longest parameter name for alignment
    const maxParamNameLength = Math.max(
      ...Object.keys(filteredParams).map((key) => key.length),
    );

    // Create parameter table with aligned values for both display and copy
    const paramTable = Object.entries(filteredParams)
      .map(([key, value]) => {
        const paddedKey = key.padEnd(maxParamNameLength);
        return `${paddedKey}\t${value}`;
      })
      .join("\n");

    // Calculate offset based on number of parameters
    const numParams = Object.keys(filteredParams).length;
    const tablePrefix = paramTable ? `${paramTable}\n\n` : "";

    // For BYOD with advanced-backend
    if (
      functionNameExcel === "WIDGET" &&
      widget.connectionType === "advanced-backend"
    ) {
      const rangeRef = `A1:B${numParams}`;
      const displayFormat = `${tablePrefix}=WORKSPACE.WIDGET(\n    "${widget.sourceName}",\n    "${widget.widgetId}",\n    ${rangeRef}\n)`;
      const copyFormat = `${tablePrefix}=WORKSPACE.WIDGET("${widget.sourceName}","${widget.widgetId}",${rangeRef})`;
      return { display: displayFormat, copy: copyFormat };
    }

    // For other functions, format with proper indentation for display
    const formattedParams = Object.entries(filteredParams)
      .map(([key, value]) => `    ${key}=${formatParamValue(value)}`)
      .join(",\n");

    // Create single line format for copy
    const singleLineParams = Object.entries(filteredParams)
      .map(([key, value]) => `${key}=${formatParamValue(value)}`)
      .join(",");

    const displayFormat = `${tablePrefix}=WORKSPACE.${functionNameExcel}(\n${formattedParams}\n)`;
    const copyFormat = `${tablePrefix}=WORKSPACE.${functionNameExcel}(${singleLineParams})`;

    return { display: displayFormat, copy: copyFormat };
  };

  try {
    // Single Widget
    if (functionNameExcel === "WIDGET" && widget.connectionType === "single") {
      const paramNamesExcelBYOD = widget.name ? [`"${widget.name}"`] : [];

      const { display, copy } = getExplicitParamsFormat(widget, storageParams);
      return {
        display: getDisplayFormat(paramNamesExcelBYOD.filter(Boolean)),
        copy: getSingleLineFormat(paramNamesExcelBYOD.filter(Boolean)),
        explicitParamsCopy: copy,
        explicitParamsDisplay: display,
      };
    }
    // Advanced Backend
    if (functionNameExcel === "WIDGET" && widgetPrefix === "database") {
      const paramNamesExcelBYOD = compact([
        widget.name ? `"${widget.name}"` : null,
        widgetPrefix ? `"${widgetPrefix}"` : null,
      ]);
      const { display, copy } = getExplicitParamsFormat(widget, storageParams);
      return {
        display: getDisplayFormat(paramNamesExcelBYOD),
        copy: getSingleLineFormat(paramNamesExcelBYOD),
        explicitParamsCopy: copy,
        explicitParamsDisplay: display,
      };
    }

    if (
      functionNameExcel === "WIDGET" &&
      widget.connectionType === "advanced-backend"
    ) {
      const paramNamesExcelBYOD = compact([
        widget.sourceName ? `"${widget.sourceName}"` : null,
        widget.widgetId ? `"${widget.widgetId}"` : null,
      ]);

      // Add all parameters including symbol and date, but only if they have non-empty values
      const allParams = Object.entries(storageParams)
        .filter(([key, value]) => {
          // Skip numeric keys and object values
          if (Number.isNaN(Number(key)) === false || typeof value === "object") {
            return false;
          }
          const formattedValue = formatParamValue(value);
          return formattedValue && formattedValue !== '""' && formattedValue !== '""';
        })
        .map(([key, value]) => {
          const formattedValue = formatParamValue(value);
          return `"${key}",${formattedValue}`;
        })
        .join(";");

      if (allParams) {
        paramNamesExcelBYOD.push(`{${allParams}}`);
      }

      const { display, copy } = getExplicitParamsFormat(widget, storageParams);
      return {
        display: getDisplayFormat(paramNamesExcelBYOD),
        copy: getSingleLineFormat(paramNamesExcelBYOD),
        explicitParamsCopy: copy,
        explicitParamsDisplay: display,
      };
    }

    return {
      display: funcs,
      copy: funcs,
    };
  } catch (error) {
    return {
      display: funcs,
      copy: funcs,
    };
  }
}

export default function FunctionsDialog({
  open,
  setOpen,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  const [useExplicitParams, setUseExplicitParams] = useState(false);
  const excelAddIn = useShallowAccessStore((state) => !!state.access?.excel_add_in);
  const { widget, widgetFromJSON } = useWidgetContext();
  const excelDataFunction = widget.external
    ? ["WORKSPACE.WIDGET"]
    : widgetFromJSON?.excelDataFunction;

  const memorizedExcelDataFunction = useMemo(() => {
    return excelDataFunction?.map((func, index) => {
      const { display, copy, explicitParamsCopy, explicitParamsDisplay } = getFunc(
        func,
        widget,
      );
      return (
        <div key={index} className="flex flex-col gap-4 mb-2">
          <div className="flex gap-2">
            <CodeSnippet
              disabled={!excelAddIn}
              text={useExplicitParams ? (explicitParamsDisplay ?? display) : display}
              className="grow w-32"
              hideCopy={true}
            />
          </div>
          {useExplicitParams && excelDataFunction?.[0] === "WORKSPACE.WIDGET" && (
            <div className="body-xs-regular flex items-start gap-2 text-ds-text-caption">
              <Icon id="warning-icon" className="h-4 w-4 mt-0.5 shrink-0" />
              <span>
                Note that the range{" "}
                <strong className="text-ds-text-body">
                  A1:B
                  {
                    Object.keys(widget.storage?.params || {}).filter((key) => {
                      const value = widget.storage?.params?.[key];
                      return (
                        value !== undefined &&
                        value !== null &&
                        value !== "" &&
                        !(
                          typeof value === "object" &&
                          value !== null &&
                          "value" in value
                        )
                      );
                    }).length
                  }
                </strong>{" "}
                implies that you paste this into the first cell of your excel
                spreadsheet.
              </span>
            </div>
          )}
          <div className="flex items-center gap-4">
            <Button
              variant="primary"
              size="sm"
              disabled={!excelAddIn}
              onClick={() => {
                navigator.clipboard.writeText(
                  useExplicitParams ? (explicitParamsCopy ?? copy) : copy,
                );
                showNotification({
                  message: "Excel formula successfully copied.",
                  description: (
                    <>
                      Note: The Add-in for Excel is required to get updated data.
                      {excelDocsHref && (
                        <>
                          {" "}
                          More information can be found in the{" "}
                          <a
                            href={excelDocsHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline text-link-color hover:opacity-80"
                          >
                            Excel add-in docs
                          </a>
                          .
                        </>
                      )}
                    </>
                  ),
                  toastType: "success",
                });
                setOpen(false);
              }}
            >
              Copy to clipboard
            </Button>
            <Checkbox
              checked={useExplicitParams}
              onCheckedChange={(checked) => setUseExplicitParams(checked === true)}
              disabled={!excelAddIn}
              label="with explicit parameters"
              labelClassName="whitespace-nowrap"
            />
          </div>
        </div>
      );
    });
  }, [excelDataFunction, widget, excelAddIn, useExplicitParams]);

  return (
    <BaseDialog
      className="max-w-xs lg:max-w-xl"
      open={open}
      onClose={() => setOpen(false)}
    >
      <DialogTitle>Excel Formula</DialogTitle>
      <div className="flex flex-col gap-3 flex-1">
        {excelDataFunction !== undefined && (
          <div className="flex flex-col gap-1">
            <div className="flex gap-1 items-center flex-wrap">
              <DialogDescription
                className={cn("text-ds-text-body", {
                  "text-general-label-disabled": !excelAddIn,
                })}
              >
                Access <strong className="text-ds-text-heading">{widget.name}</strong>
                {" data from "}
                <strong className="text-ds-text-heading">{widget.sourceName}</strong>
                {" in Excel."}
              </DialogDescription>
            </div>
            <div className="flex flex-col mt-2">{memorizedExcelDataFunction}</div>
          </div>
        )}
      </div>
    </BaseDialog>
  );
}

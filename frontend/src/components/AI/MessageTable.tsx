import { memo, type ReactNode, useCallback, useRef } from "react";
import { toast } from "sonner";
import { parseValue } from "~/lib/utils";
import Icon from "../Icon";
import Tooltip from "../Tooltip";

type MessageTableProps = {
  children: ReactNode;
};

const MessageTable = memo((props: MessageTableProps) => {
  const { children } = props;
  const tableRef = useRef<HTMLTableElement>(null);

  const convertTableToJson = useCallback(() => {
    const table = tableRef.current;
    if (!table) {
      console.warn("Table element not found.");
      return null;
    }

    const headersExist = table.querySelectorAll("thead th").length > 0;
    const tbody = table.querySelector("tbody");

    const headers = Array.from(
      table.querySelectorAll<HTMLTableCellElement>(headersExist ? "thead th" : "tr th"),
      (th) => (th.innerText || th.textContent || "").trim(),
    );
    const rows = Array.from(table.querySelectorAll(tbody ? "tbody tr" : "tr")).filter(
      (row) => row.querySelectorAll("td").length > 0,
    );

    const jsonData = rows.reduce<Record<string, string | number | null>[]>(
      (acc, row) => {
        const rowData = Array.from(row.querySelectorAll("td")).reduce(
          (rowAcc, cell, index) => {
            const header = headers[index] || `Column ${index + 1}`;

            const cellText = (cell.innerText || cell.textContent).trim();
            const cellValue = parseValue(cellText);
            rowAcc[header] = cellValue;
            return rowAcc;
          },
          {} as Record<string, string | number | null>,
        );

        // Ensures first row has all keys
        if (acc.length > 0) {
          for (const key of Object.keys(rowData)) {
            if (!Object.keys(acc[0]).includes(key)) {
              acc[0][key] = null;
            }
          }
        }
        acc.push(rowData);
        return acc;
      },
      [],
    );

    return jsonData;
  }, [tableRef]);

  return (
    <div className="bg-light-100 dark:bg-dark-400 rounded p-0.5 space-y-2 mb-2">
      <div className="overflow-auto">
        <table
          ref={tableRef}
          children={children}
          className="overflow-auto table-auto rounded-[2px] w-full !m-0 dark:bg-dark-700 bg-light-200
        [&_tbody]:bg-white [&_tr]:even:bg-light-50 dark:[&_tbody]:bg-dark-600
        dark:[&_tr]:even:bg-dark-500 [&_td]:pl-1 [&_th]:pl-1 [&_th]:pt-1.5 [&_thead]:border-none"
        />
      </div>
      <div className="flex gap-x-2 pb-1">
        <Tooltip message="Copy table to clipboard">
          <button
            onClick={() => {
              const rowsData = convertTableToJson();
              if (!rowsData) return toast.error("Failed to extract table data");

              const headerKeys = Object.keys(rowsData[0] || {});
              const headers = headerKeys.join("\t");
              const rows = rowsData
                .map((row) =>
                  headerKeys
                    .map((col) => {
                      const cell = row[col];
                      return cell === null || cell === undefined ? "" : cell;
                    })
                    .join("\t"),
                )
                .join("\n");
              const content = `${headers}\n${rows}`;
              navigator.clipboard
                .writeText(content)
                .then(() => {
                  toast.success("Table copied to clipboard");
                })
                .catch((err) => {
                  toast.error("Failed to copy table to clipboard", {
                    description: err.message,
                  });
                });
            }}
            className="hover:text-black dark:hover:text-white h-3 w-3"
          >
            <Icon
              id="clipboard-icon"
              className="hover:text-black dark:hover:text-white h-3 w-3"
            />
          </button>
        </Tooltip>
      </div>
    </div>
  );
});

export default MessageTable;

import type { ReactNode } from "react";
import { protocolCasesData } from "./data";
import { TableWrap } from "./shared";
import styles from "./styles.module.css";

function Cases({ columns, rows }: { columns: string[]; rows: ReactNode[][] }) {
  return (
    <TableWrap>
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, position) => (
                <td key={position}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

function Code({ value }: { value: string | null }) {
  return value === null ? <span className={styles.muted}>none</span> : <code>{value}</code>;
}

export function ContractChecks() {
  return (
    <Cases
      columns={["Check", "Message"]}
      rows={protocolCasesData.contract.map((check) => [
        check.label,
        check.messages.map((message) => <code key={message}>{message}</code>),
      ])}
    />
  );
}

export function RawRowCases() {
  return (
    <Cases
      columns={["Case", "Response", "rawDataKey", "Rows"]}
      rows={protocolCasesData.rawRows.map((row) => [
        row.label,
        <Code key="response" value={row.response} />,
        <Code key="key" value={row.rawDataKey} />,
        <Code key="rows" value={row.rows} />,
      ])}
    />
  );
}

export function McpLinkActive() {
  return (
    <Cases
      columns={["Case", "mcp_tool of the widget", "Link in the request to the agent"]}
      rows={protocolCasesData.mcpActive.map((row) => [
        row.label,
        <Code key="link" value={row.link === "null" ? null : row.link} />,
        <Code key="result" value={row.result === "null" ? null : row.result} />,
      ])}
    />
  );
}

export function McpLinkCites() {
  return (
    <Cases
      columns={["Case", "Arguments of the call", "Cited widget", "input_args", "details"]}
      rows={protocolCasesData.mcpCite.map((row) => [
        row.label,
        <Code key="call" value={row.call} />,
        row.cited ?? <span className={styles.muted}>no widget</span>,
        <Code key="input" value={row.inputArgs} />,
        <Code key="details" value={row.details} />,
      ])}
    />
  );
}

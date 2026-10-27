import Heading from "@theme/Heading";
import { FieldTable } from "./agent";
import { bridgeData } from "./data";
import { Codes, FactValue, MessageTable } from "./plugins";
import { Contents, TableWrap } from "./shared";
import styles from "./styles.module.css";
import type { Unit } from "./format";

export function BridgeValue({ of, unit, plain }: { of: string; unit?: Unit; plain?: boolean }) {
  return <FactValue values={bridgeData.values} of={of} unit={unit} plain={plain} />;
}

export function BridgeList({ of }: { of: "errorCodes" | "agentOnlyCommands" }) {
  return <Codes items={bridgeData[of]} />;
}

export function BridgeMessages({ direction }: { direction: "toTab" | "toApi" }) {
  return <MessageTable messages={bridgeData[direction]} />;
}

export function BridgeResultFields() {
  return <FieldTable fields={bridgeData.result} depth={1} />;
}

export function BridgeCommandSummary() {
  return (
    <TableWrap>
      <table>
        <thead>
          <tr>
            <th>Command</th>
            <th>Sent by</th>
            <th>What the tab does</th>
          </tr>
        </thead>
        <tbody>
          {bridgeData.commands.map((command) => (
            <tr key={command.name}>
              <td>
                <a href={`#bridge-command-${command.name}`}>
                  <code>{command.name}</code>
                </a>
              </td>
              <td>
                {command.tool === null ? (
                  <>
                    the resource <BridgeValue of="constants.widgetsSchemaResource" />
                  </>
                ) : (
                  <>
                    the tool <code>{command.tool}</code>
                  </>
                )}
              </td>
              <td>{command.meaning}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

export function BridgeCommandFields() {
  return (
    <>
      <Contents items={bridgeData.commands.map((command) => ({ id: `bridge-command-${command.name}`, label: command.name }))} />
      {bridgeData.commands.map((command) => (
        <div key={command.name} className={styles.block}>
          <Heading as="h3" id={`bridge-command-${command.name}`}>
            <code>{command.name}</code>
          </Heading>
          <p>{command.meaning}</p>
          {command.fields.length > 0 ? <FieldTable fields={command.fields} depth={1} /> : <p>The command has no arguments.</p>}
        </div>
      ))}
    </>
  );
}

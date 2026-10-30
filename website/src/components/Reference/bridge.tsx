import { FieldTable } from "./agent";
import { bridgeData } from "./data";
import type { Unit } from "./format";
import { Entry, firstSentence, Index, ItemList, Section } from "./kit";
import { Codes, FactValue, MessageTable } from "./plugins";

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
    <ItemList
      items={bridgeData.commands.map((command) => ({
        key: command.name,
        title: (
          <a href={`#bridge-command-${command.name}`}>
            <code>{command.name}</code>
          </a>
        ),
        description: command.meaning,
        meta: [
          [
            "Sent by",
            command.tool === null ? (
              <>
                the resource <BridgeValue of="constants.widgetsSchemaResource" />
              </>
            ) : (
              <>
                the tool <code>{command.tool}</code>
              </>
            ),
          ],
        ],
      }))}
    />
  );
}

export function BridgeCommandFields() {
  return (
    <>
      <Index items={bridgeData.commands.map((command) => ({ id: `bridge-command-${command.name}`, label: <code>{command.name}</code>, summary: firstSentence(command.meaning) }))} />
      {bridgeData.commands.map((command) => (
        <Entry key={command.name} id={`bridge-command-${command.name}`} title={<code>{command.name}</code>} description={command.meaning}>
          <Section title="Arguments">
            <FieldTable fields={command.fields} depth={1} />
          </Section>
        </Entry>
      ))}
    </>
  );
}

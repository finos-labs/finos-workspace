import type { CliCommand } from "../../data/types";
import { cliData, mcpData } from "./data";
import { Fields, fromSchema } from "./fields";
import { Chip, Entry, firstSentence, Index, ItemList, Section } from "./kit";
import { formatValue, slug } from "./format";
import { Prose } from "./prose";
import styles from "./styles.module.css";

function commandId(command: CliCommand): string {
  return `command-${slug(command.prog)}`;
}

function allCommands(command: CliCommand): CliCommand[] {
  return [command, ...command.commands.flatMap(allCommands)];
}

function quoted(values: string[]): string {
  return values.map((value) => `"${value}"`).join(" | ");
}

function CommandEntry({ command }: { command: CliCommand }) {
  const fields = command.arguments.map((argument) => ({
    path: argument.flags.join(", "),
    type: [argument.choices ? quoted(argument.choices) : (argument.metavar ?? (argument.positional ? "argument" : "flag"))],
    required: argument.required,
    description: argument.help,
    defaultValue: argument.default === null || argument.default === undefined ? undefined : formatValue(argument.default),
    constraints: argument.multiple ? ["repeatable"] : [],
  }));
  const text = command.description && command.description !== command.help ? command.description : undefined;
  return (
    <Entry id={commandId(command)} title={<code>{command.prog}</code>} lead={command.help ?? undefined} description={text}>
      {fields.length > 0 ? (
        <Section title="Arguments">
          <Fields fields={fields} />
        </Section>
      ) : null}
    </Entry>
  );
}

export function CliCommands({ noun }: { noun: string }) {
  const found = cliData.commands.find((item) => item.name === noun);
  if (found === undefined) throw new Error(`No command ${noun}`);
  const commands = allCommands(found);
  return (
    <>
      <Index
        items={commands.map((command) => ({
          id: commandId(command),
          label: <code>{command.prog.replace(`${cliData.prog} `, "")}</code>,
          summary: command.help ?? undefined,
        }))}
      />
      {commands.map((command) => (
        <CommandEntry key={command.prog} command={command} />
      ))}
    </>
  );
}

export function McpReference({ part }: { part: "instructions" | "tools" | "resources" | "prompts" }) {
  if (part === "instructions") {
    return (
      <div className={styles.callout}>
        <p className={styles.calloutTitle}>Instructions sent to the AI tool</p>
        <Prose text={mcpData.instructions} />
      </div>
    );
  }
  if (part === "tools") {
    return (
      <>
        <Index
          items={mcpData.tools.map((tool) => ({
            id: `tool-${tool.name}`,
            label: <code>{tool.name}</code>,
            summary: firstSentence(tool.description),
          }))}
        />
        {mcpData.tools.map((tool) => (
          <Entry key={tool.name} id={`tool-${tool.name}`} title={<code>{tool.name}</code>} description={tool.description}>
            <Section title="Parameters">
              <Fields fields={fromSchema(tool.parameters.properties)} empty="This tool takes no parameters." />
            </Section>
          </Entry>
        ))}
      </>
    );
  }
  if (part === "resources") {
    return (
      <ItemList
        items={mcpData.resources.map((resource) => ({
          key: resource.uri,
          title: <code className={styles.fieldName}>{resource.uri}</code>,
          chips: resource.mimeType ? <Chip>{resource.mimeType}</Chip> : undefined,
          description: resource.description,
          meta: [["Name", resource.name]],
        }))}
      />
    );
  }
  return (
    <ItemList
      items={mcpData.prompts.map((prompt) => ({
        key: prompt.name,
        title: <code className={styles.fieldName}>{prompt.name}</code>,
        description: prompt.description,
        meta:
          prompt.arguments.length === 0
            ? [["Arguments", "none"]]
            : [["Arguments", prompt.arguments.map((argument) => argument.name).join(", ")]],
      }))}
    />
  );
}

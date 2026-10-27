import Heading from "@theme/Heading";
import type { CliCommand } from "../../data/types";
import { cliData, mcpData } from "./data";
import { formatValue, slug } from "./format";
import { Contents, TableWrap, TypeText } from "./shared";
import styles from "./styles.module.css";

function Command({ command }: { command: CliCommand }) {
  const id = `command-${slug(command.prog)}`;
  return (
    <div className={styles.block}>
      <Heading as="h3" id={id}>
        <code>{command.prog}</code>
      </Heading>
      {command.help ? <p>{command.help}</p> : null}
      {command.arguments.length > 0 ? (
        <TableWrap>
          <table>
            <thead>
              <tr>
                <th>Argument</th>
                <th>Required</th>
                <th>Default</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {command.arguments.map((argument) => (
                <tr key={argument.flags.join(" ")}>
                  <td>
                    <code>{argument.flags.join(", ")}</code>
                    {argument.choices ? <> (one of {argument.choices.map((choice) => `"${choice}"`).join(", ")})</> : null}
                    {argument.multiple ? " (repeatable)" : ""}
                  </td>
                  <td>{argument.required ? "yes" : "no"}</td>
                  <td>
                    <code>{formatValue(argument.default)}</code>
                  </td>
                  <td>{argument.help}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      ) : null}
      {command.commands.map((child) => (
        <Command key={child.prog} command={child} />
      ))}
    </div>
  );
}

function allCommands(command: CliCommand): CliCommand[] {
  return [command, ...command.commands.flatMap(allCommands)];
}

export function CliCommands({ noun }: { noun: string }) {
  const found = cliData.commands.find((item) => item.name === noun);
  if (found === undefined) throw new Error(`No command ${noun}`);
  return (
    <>
      <Contents items={allCommands(found).map((command) => ({ id: `command-${slug(command.prog)}`, label: command.prog.replace(`${cliData.prog} `, "") }))} />
      <Command command={found} />
    </>
  );
}

export function McpReference({ part }: { part: "instructions" | "tools" | "resources" | "prompts" }) {
  if (part === "instructions") {
    return <blockquote className={styles.pre}>{mcpData.instructions}</blockquote>;
  }
  if (part === "tools") {
    return (
      <>
        <Contents items={mcpData.tools.map((tool) => ({ id: `tool-${tool.name}`, label: tool.name }))} />
        {mcpData.tools.map((tool) => (
          <div key={tool.name} className={styles.block}>
            <Heading as="h3" id={`tool-${tool.name}`}>
              <code>{tool.name}</code>
            </Heading>
            <p className={styles.pre}>{tool.description}</p>
            {tool.parameters.properties.length > 0 ? (
              <TableWrap>
                <table>
                  <thead>
                    <tr>
                      <th>Parameter</th>
                      <th>Type</th>
                      <th>Required</th>
                      <th>Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tool.parameters.properties.map((property) => (
                      <tr key={property.name}>
                        <td>
                          <code>{property.name}</code>
                        </td>
                        <td>
                          <TypeText type={property.type} />
                        </td>
                        <td>{property.required ? "yes" : "no"}</td>
                        <td>
                          {property.description}
                          {property.notes.length > 0 ? <code> {property.notes.join("; ")}</code> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            ) : (
              <p>No parameters.</p>
            )}
          </div>
        ))}
      </>
    );
  }
  if (part === "resources") {
    return (
      <TableWrap>
        <table>
          <thead>
            <tr>
              <th>URI</th>
              <th>Name</th>
              <th>Type</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {mcpData.resources.map((resource) => (
              <tr key={resource.uri}>
                <td>
                  <code>{resource.uri}</code>
                </td>
                <td>{resource.name}</td>
                <td>{resource.mimeType}</td>
                <td>{resource.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    );
  }
  return (
    <TableWrap>
      <table>
        <thead>
          <tr>
            <th>Prompt</th>
            <th>Arguments</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          {mcpData.prompts.map((prompt) => (
            <tr key={prompt.name}>
              <td>
                <code>{prompt.name}</code>
              </td>
              <td>{prompt.arguments.length === 0 ? "none" : prompt.arguments.map((argument) => argument.name).join(", ")}</td>
              <td>{prompt.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

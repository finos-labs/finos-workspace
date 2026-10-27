import Heading from "@theme/Heading";
import type { CssStats, Token, TokenUsage } from "../../data/types";
import { cssData } from "./data";
import { slug } from "./format";
import { Lines, TableWrap } from "./shared";
import styles from "./styles.module.css";

function allTokens(): Token[] {
  return cssData.tokenFiles.flatMap((file) => file.tokens);
}

function shortPath(path: string): string {
  return path.split("/").slice(-2).join("/");
}

function Swatch({ colour }: { colour?: string }) {
  return colour ? <span className={styles.swatch} style={{ background: colour }} /> : null;
}

function Readers({ usage }: { usage: TokenUsage }) {
  const parts: string[] = [];
  if (usage.uses > 0) parts.push(`${usage.uses} class uses in ${usage.files} ${usage.files === 1 ? "file" : "files"}`);
  if (usage.direct > 0) parts.push(`${usage.direct} ${usage.direct === 1 ? "rule or script reads" : "rules or scripts read"} it directly`);
  if (usage.aliasedBy > 0) parts.push(`${usage.aliasedBy} ${usage.aliasedBy === 1 ? "property refers" : "properties refer"} to it`);
  if (parts.length === 0) return <span className={styles.muted}>nothing reads it</span>;
  return <span className={styles.muted}>{parts.join("; ")}</span>;
}

export function TokenGroup({ file, group }: { file: string; group: string | string[] }) {
  const groups = Array.isArray(group) ? group : [group];
  const tokenFile = cssData.tokenFiles.find((item) => item.file.endsWith(file));
  const tokens = tokenFile?.tokens.filter((token) => groups.includes(token.group)) ?? [];
  if (tokens.length === 0) throw new Error(`No properties ${groups.join(", ")} in ${file}`);
  return (
    <TableWrap>
      <table>
        <thead>
          <tr>
            <th>Property</th>
            <th>Value</th>
            <th>Used</th>
          </tr>
        </thead>
        <tbody>
          {tokens.map((token) => (
            <tr key={token.name}>
              <td>
                <code>{token.name}</code>
              </td>
              <td>
                <div>
                  <span className={styles.muted}>Light </span>
                  <Swatch colour={token.lightColor} />
                  {token.light ? <code>{token.light}</code> : <span className={styles.muted}>none</span>}
                </div>
                <div>
                  <span className={styles.muted}>Dark </span>
                  <Swatch colour={token.darkColor} />
                  {token.dark ? <code>{token.dark}</code> : <span className={styles.muted}>as light</span>}
                </div>
                {token.forceLight ? (
                  <div>
                    <span className={styles.muted}>Forced light </span>
                    <code>{token.forceLight}</code>
                  </div>
                ) : null}
              </td>
              <td>
                {token.usage && token.usage.classes.length > 0 ? <Lines items={token.usage.classes} /> : null}
                {token.usage ? <Readers usage={token.usage} /> : null}
                {token.usage && token.usage.top.length > 0 ? (
                  <div className={styles.muted}>{token.usage.top.map(shortPath).join(", ")}</div>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

export function PaletteGroup({ group }: { group: string }) {
  const tokens = allTokens().filter((token) => token.group === group && token.name.startsWith("--color-"));
  if (tokens.length === 0) throw new Error(`No palette ${group}`);
  return (
    <TableWrap>
      <table>
        <thead>
          <tr>
            <th>Property</th>
            <th>Value</th>
            <th>Used</th>
          </tr>
        </thead>
        <tbody>
          {tokens.map((token) => (
            <tr key={token.name}>
              <td>
                <code>{token.name}</code>
              </td>
              <td>
                <Swatch colour={token.lightColor} />
                <code>{token.lightColor ?? token.light}</code>
              </td>
              <td>
                {token.usage && token.usage.classes.length > 0 ? <Lines items={token.usage.classes} /> : null}
                {token.usage ? <Readers usage={token.usage} /> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

export function Stat({ of }: { of: keyof CssStats }) {
  return <>{cssData.stats[of]}</>;
}

export function UnreadProperties() {
  const unread = allTokens().filter(
    (token) => token.usage && token.usage.uses === 0 && token.usage.direct === 0 && token.usage.aliasedBy === 0,
  );
  return (
    <ul>
      {unread.map((token, index) => (
        <li key={index}>
          <code>{token.name}</code>
        </li>
      ))}
    </ul>
  );
}

export function PluginTokens() {
  return (
    <TableWrap>
      <table>
        <thead>
          <tr>
            <th>Token</th>
            <th>Read from</th>
            <th>Light</th>
            <th>Dark</th>
          </tr>
        </thead>
        <tbody>
          {cssData.pluginTokens.map((token) => (
            <tr key={token.name}>
              <td>
                <code>{token.name}</code>
              </td>
              <td>
                <code>{token.property}</code>
              </td>
              <td>
                <Swatch colour={token.light} />
                <code>{token.light}</code>
              </td>
              <td>
                <Swatch colour={token.dark} />
                <code>{token.dark}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

export function ReportComponents() {
  return (
    <>
      {cssData.report.groups.map((group) => (
        <div key={group.title}>
          <Heading as="h3" id={`report-${slug(group.title)}`}>
            {group.title}
          </Heading>
          <TableWrap>
            <table>
              <thead>
                <tr>
                  <th>Class</th>
                  <th>What it is</th>
                </tr>
              </thead>
              <tbody>
                {group.items.map((item, index) => (
                  <tr key={index}>
                    <td>{item.classes.length > 0 ? <Lines items={item.classes} /> : <span className={styles.muted}>no class</span>}</td>
                    <td>{item.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </div>
      ))}
    </>
  );
}

export function ReportColors() {
  return (
    <TableWrap>
      <table>
        <thead>
          <tr>
            <th>Element</th>
            <th>Color</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {cssData.report.colours.map((colour) => (
            <tr key={colour.element}>
              <td>{colour.element}</td>
              <td>{colour.colour}</td>
              <td>
                <Swatch colour={colour.hex} />
                <code>{colour.hex}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

export function ForceLightList() {
  const names = allTokens()
    .filter((token) => token.forceLight !== undefined)
    .map((token) => token.name);
  return (
    <p>
      {names.map((name, index) => (
        <span key={name}>
          {index > 0 ? ", " : ""}
          <code>{name}</code>
        </span>
      ))}
    </p>
  );
}

import Heading from "@theme/Heading";
import type { Selector } from "../../data/types";
import { cssData } from "./data";
import { shortFile, slug } from "./format";
import { Contents, Lines, TableWrap } from "./shared";
import styles from "./styles.module.css";

function SelectorRows({ selectors }: { selectors: Selector[] }) {
  return (
    <TableWrap>
      <table>
        <thead>
          <tr>
            <th>Selector</th>
            <th>Inside</th>
            <th>Declarations</th>
          </tr>
        </thead>
        <tbody>
          {selectors.map((selector, index) => (
            <tr key={index}>
              <td>
                <code>{selector.selector}</code>
              </td>
              <td>{selector.context.length > 0 ? <Lines items={selector.context} /> : <span className={styles.muted}>top level</span>}</td>
              <td>
                <Lines items={selector.declarations} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

export function SelectorTable({ files, source }: { files?: string[]; source?: "report" }) {
  if (source === "report") return <SelectorRows selectors={cssData.reportClasses} />;
  return (
    <>
      {(files ?? []).map((file) => {
        const selectors = cssData.selectors.filter((item) => item.file.endsWith(file));
        return (
          <div key={file}>
            <Heading as="h3" id={`selectors-${slug(file)}`}>
              <code>{shortFile(file)}</code>
            </Heading>
            <SelectorRows selectors={selectors} />
          </div>
        );
      })}
    </>
  );
}

export function UtilityTable() {
  return (
    <TableWrap>
      <table>
        <thead>
          <tr>
            <th>Class</th>
            <th>Declarations</th>
            <th>Nested selectors</th>
            <th>Used by</th>
          </tr>
        </thead>
        <tbody>
          {cssData.utilities.map((utility) => (
            <tr key={utility.name}>
              <td>
                <code>.{utility.name}</code>
              </td>
              <td>
                <Lines items={utility.declarations} />
              </td>
              <td>
                {utility.nested.length === 0 ? (
                  <span className={styles.muted}>none</span>
                ) : (
                  <ul className={styles.lines}>
                    {utility.nested.map((nested, index) => (
                      <li key={index}>
                        <code>{nested.selector}</code>: <code>{nested.declarations.join("; ")}</code>
                      </li>
                    ))}
                  </ul>
                )}
              </td>
              <td>
                {utility.uses === undefined ? (
                  <span className={styles.muted}>not counted</span>
                ) : utility.uses === 0 ? (
                  <span className={styles.muted}>nothing in the source</span>
                ) : (
                  <>
                    <Lines items={(utility.top ?? []).map((path) => path.split("/").slice(-2).join("/"))} />
                    <span className={styles.muted}>
                      {utility.uses} uses in {utility.files} {utility.files === 1 ? "file" : "files"}
                    </span>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

export function AtRules() {
  return (
    <>
      <Heading as="h3" id="font-faces">
        Font faces
      </Heading>
      <TableWrap>
        <table>
          <thead>
            <tr>
              <th>Family</th>
              <th>Style</th>
              <th>Weight</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {cssData.fontFaces.map((face, index) => (
              <tr key={index}>
                <td>
                  <code>{face.family}</code>
                </td>
                <td>{face.style || <span className={styles.muted}>default</span>}</td>
                <td>{face.weight}</td>
                <td>
                  <code>{face.source}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
      <Heading as="h3" id="keyframes">
        Keyframes
      </Heading>
      <p>
        {cssData.keyframes.map((frame, index) => (
          <span key={frame.name}>
            {index > 0 ? ", " : ""}
            <code>{frame.name}</code>
          </span>
        ))}
      </p>
    </>
  );
}

import type { BuiltRequestView } from "../../data/types";
import { widgetRequestData } from "./data";
import { Entry } from "./kit";
import { TableWrap } from "./shared";
import styles from "./styles.module.css";

function Cell({ value }: { value: string | null }) {
  return value === null ? <span className={styles.muted}>not possible</span> : <code>{value}</code>;
}

export function ValueEncodings() {
  return (
    <TableWrap>
      <table>
        <thead>
          <tr>
            <th>Parameter</th>
            <th>Value</th>
            <th>Query</th>
            <th>Header</th>
            <th>Body</th>
            <th>Path</th>
          </tr>
        </thead>
        <tbody>
          {widgetRequestData.values.map((row) => (
            <tr key={row.label}>
              <td>{row.label}</td>
              <td>
                <code>{row.value}</code>
              </td>
              <td>
                <Cell value={row.query} />
              </td>
              <td>
                <Cell value={row.header} />
              </td>
              <td>
                <Cell value={row.body} />
              </td>
              <td>
                <Cell value={row.path} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

export function OmittedValues() {
  return (
    <TableWrap>
      <table>
        <thead>
          <tr>
            <th>Value of a parameter</th>
            <th>Sent</th>
          </tr>
        </thead>
        <tbody>
          {widgetRequestData.omitted.map((row) => (
            <tr key={row.label}>
              <td>{row.label}</td>
              <td>{row.sent ? "yes" : "no"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

export function RequestProblems() {
  return (
    <TableWrap>
      <table>
        <thead>
          <tr>
            <th>Problem</th>
            <th>What the widget shows</th>
          </tr>
        </thead>
        <tbody>
          {widgetRequestData.problems.map((row) => (
            <tr key={row.label}>
              <td>{row.label}</td>
              <td>
                {row.messages.map((message) => (
                  <code key={message}>{message}</code>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

function Request({ title, request }: { title: string; request: BuiltRequestView }) {
  const headers = Object.entries(request.headers ?? {});
  return (
    <>
      <p className={styles.lead}>{title}</p>
      <pre className={styles.json}>
        <code>
          {`${request.method} ${request.url}`}
          {headers.map(([name, value]) => `\n${name}: ${value}`)}
          {request.body === undefined ? "" : `\n\n${JSON.stringify(request.body)}`}
        </code>
      </pre>
    </>
  );
}

export function RequestExamples() {
  return (
    <>
      {widgetRequestData.examples.map((example, index) => (
        <Entry key={example.label} id={`request-example-${index}`} title={example.label}>
          <p className={styles.lead}>Widget definition</p>
          <pre className={styles.json}>
            <code>{JSON.stringify(example.widget, null, 2)}</code>
          </pre>
          <Request title="Request of the widget" request={example.request} />
          <p className={styles.lead}>Definition of the endpoint parameter that loads the choices</p>
          <pre className={styles.json}>
            <code>{JSON.stringify(example.optionsParam, null, 2)}</code>
          </pre>
          <Request title="Request for its choices" request={example.options} />
        </Entry>
      ))}
    </>
  );
}

import { iframeData } from "./data";
import { TableWrap } from "./shared";

export function IframeLimits() {
  return (
    <ul>
      <li>
        FINOS Workspace gives up on a <code>workspace-request</code> after <code>{iframeData.limits.requestTimeoutMs}</code> milliseconds and fails the request with a time-out.
      </li>
      <li>
        A message qualifies as coming from the widget's iframe when it comes from a frame that is nested at most <code>{iframeData.limits.maxFrameDepth}</code> levels deep inside it.
      </li>
    </ul>
  );
}

export function ParamUpdateTexts() {
  return (
    <TableWrap>
      <table>
        <thead>
          <tr>
            <th>Value in the message</th>
            <th>Text that FINOS Workspace stores</th>
          </tr>
        </thead>
        <tbody>
          {iframeData.values.map((row) => (
            <tr key={row.label}>
              <td>{row.label}</td>
              <td>{row.text === "" ? "an empty string" : <code>{row.text}</code>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

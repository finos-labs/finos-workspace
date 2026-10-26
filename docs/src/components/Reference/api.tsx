import Heading from "@theme/Heading";
import { apiData } from "./data";
import { slug } from "./format";
import { Contents, TableWrap, TypeText } from "./shared";
import styles from "./styles.module.css";

export function ApiTag({ tag, schemaPage }: { tag: string; schemaPage: string }) {
  const found = apiData.tags.find((item) => item.name === tag);
  if (found === undefined) throw new Error(`No API tag ${tag}`);
  const operationId = (method: string, path: string) => `op-${method.toLowerCase()}-${slug(path)}`;
  return (
    <>
      <Contents
        items={found.operations.map((operation) => ({
          id: operationId(operation.method, operation.path),
          label: `${operation.method} ${operation.path}`,
        }))}
      />
      {found.operations.map((operation) => (
        <div key={`${operation.method} ${operation.path}`} className={styles.block}>
          <Heading as="h4" id={operationId(operation.method, operation.path)}>
            <span className={styles.method}>{operation.method}</span>
            <code>{operation.path}</code>
          </Heading>
          {operation.summary ? <p>{operation.summary}</p> : null}
          {operation.parameters.length > 0 ? (
            <TableWrap>
              <table>
                <thead>
                  <tr>
                    <th>Parameter</th>
                    <th>In</th>
                    <th>Required</th>
                    <th>Type</th>
                    <th>Description</th>
                  </tr>
                </thead>
                <tbody>
                  {operation.parameters.map((parameter) => (
                    <tr key={`${parameter.in}-${parameter.name}`}>
                      <td>
                        <code>{parameter.name}</code>
                      </td>
                      <td>{parameter.in}</td>
                      <td>{parameter.required ? "yes" : "no"}</td>
                      <td>
                        <TypeText type={parameter.type} schemaPage={schemaPage} />
                      </td>
                      <td>{parameter.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          ) : null}
          {operation.requestBody ? (
            <p>
              <strong>Request body</strong> ({operation.requestBody.contentType}
              {operation.requestBody.required ? ", required" : ""}): <TypeText type={operation.requestBody.schema} schemaPage={schemaPage} />
            </p>
          ) : null}
          <p>
            <strong>Responses</strong>:{" "}
            {operation.responses.map((response, index) => (
              <span key={response.code}>
                {index > 0 ? "; " : ""}
                <code>{response.code}</code> {response.description}
                {response.schema ? (
                  <>
                    {" "}
                    <TypeText type={response.schema} schemaPage={schemaPage} />
                  </>
                ) : null}
              </span>
            ))}
          </p>
        </div>
      ))}
    </>
  );
}

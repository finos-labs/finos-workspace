import { type ReactNode, useMemo, useState } from "react";
import { FileContext, type FileType } from "./FileContext";

export function FileProvider({ children }: { children: ReactNode }) {
  const [files, setFiles] = useState<FileType[]>([]);

  const childrenMemo = useMemo(() => children, [children]);

  return (
    <FileContext.Provider value={{ files, setFiles }}>
      {childrenMemo}
    </FileContext.Provider>
  );
}

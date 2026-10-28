import { type RefObject, useCallback, useEffect } from "react";

export function useAutoHeightInput(
  inputRef: RefObject<HTMLInputElement | HTMLTextAreaElement>,
  options?: {
    value?: string;
    textContent?: string;
    offset?: number;
  },
) {
  const { value, textContent, offset = 0.5 } = options ?? {};

  const handleResize = useCallback(() => {
    if (!inputRef.current) return;
    if (value !== undefined) inputRef.current.value = value;

    const target = inputRef.current;

    if (target.offsetWidth === 0) {
      return;
    }

    let contentHeight = 0;

    if (textContent !== undefined) {
      const tempDiv = document.createElement("div");
      tempDiv.style.visibility = "hidden";
      tempDiv.style.position = "absolute";
      tempDiv.style.width = `${target.offsetWidth}px`;
      tempDiv.style.font = window.getComputedStyle(target).font;
      tempDiv.style.lineHeight = window.getComputedStyle(target).lineHeight;
      tempDiv.style.whiteSpace = "pre-wrap";
      tempDiv.textContent = textContent;

      document.body.appendChild(tempDiv);
      contentHeight = tempDiv.offsetHeight;
      document.body.removeChild(tempDiv);
    }

    target.style.height = "auto";
    const newHeight = Math.max(target.scrollHeight, contentHeight);
    target.style.height = `${newHeight + offset}px`;
  }, [inputRef, value, textContent]);

  useEffect(() => {
    handleResize();
  }, [handleResize]);
}

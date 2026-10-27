import KaTeX, { type KatexOptions, ParseError } from "katex";
import {
  type ComponentPropsWithoutRef,
  type ElementType,
  type FC,
  memo,
  type ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import "katex/dist/katex.min.css";

const TeX: FC<TeXProps> = ({
  children,
  math,
  block,
  errorColor,
  renderError,
  settings,
  as: asComponent,
  ...props
}) => {
  const Component = asComponent || (block ? "div" : "span");
  const content = (children ?? math) as string;
  const [errorElement, setErrorElement] = useState(null as ReactElement | null);
  const renderElementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setErrorElement(null);
    const element = renderElementRef.current;
    if (!(content && element)) return;

    element.innerHTML = "";
    try {
      KaTeX.render(content, element, {
        displayMode: !!block,
        errorColor,
        throwOnError: !!renderError,
        ...settings,
        output: "html",
      });
    } catch (error) {
      if (error instanceof ParseError || error instanceof TypeError) {
        if (renderError) {
          setErrorElement(renderError(error));
        } else {
          element.innerHTML = error.message;
        }
      } else {
        throw error;
      }
    }
  }, [block, content, errorColor, renderError, settings, renderElementRef]);

  return (
    <>
      {errorElement}
      <Component {...props} ref={renderElementRef} />
    </>
  );
};

type TeXProps = ComponentPropsWithoutRef<"div"> &
  Partial<{
    as: ElementType;
    math: string | number;
    block: boolean;
    errorColor: string;
    renderError: (error: ParseError | TypeError) => ReactElement;
    settings: KatexOptions;
  }>;

export const InlineMath: FC<Omit<TeXProps, "block">> = memo((props) => (
  <TeX {...props} block={false} />
));

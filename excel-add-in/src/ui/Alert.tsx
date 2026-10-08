import type { ReactNode } from "react";

type Variant = "error" | "success" | "warning" | "info";

const VARIANT_CLASSES: Record<Variant, string> = {
  error: "border-red-500 bg-red-500/10 text-red-500",
  success: "border-green-500 bg-green-500/10 text-green-500",
  warning: "border-yellow-500 bg-yellow-500/10 text-yellow-500",
  info: "border-light-blue-400 bg-light-blue-400/10 text-light-blue-400",
};

interface AlertProps {
  variant: Variant;
  title: string;
  children?: ReactNode;
}

export function Alert({ variant, title, children }: AlertProps) {
  return (
    <div
      role="alert"
      className={`rounded border px-3 py-2 text-xs ${VARIANT_CLASSES[variant]}`}
    >
      <p className="font-medium">{title}</p>
      {children && <p className="mt-1 text-grey-300">{children}</p>}
    </div>
  );
}

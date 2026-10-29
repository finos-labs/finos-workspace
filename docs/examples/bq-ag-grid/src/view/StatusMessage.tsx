import type { ReactNode } from "react";

interface StatusMessageProps {
  tone: "neutral" | "error";
  title: string;
  children?: ReactNode;
  action?: { label: string; onClick: () => void };
}

export function StatusMessage({ tone, title, children, action }: StatusMessageProps) {
  return (
    <div
      className={`agw-status agw-status--${tone}`}
      role={tone === "error" ? "alert" : "status"}
    >
      <p className="agw-status__title">{title}</p>
      {children && <p className="agw-status__body">{children}</p>}
      {action && (
        <button type="button" className="agw-button" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}

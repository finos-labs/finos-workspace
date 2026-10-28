import Link from "@docusaurus/Link";
import styles from "./styles.module.css";

const modes = [
  {
    to: "/quick-start",
    action: "Start",
    label: "Quick Start",
    text: "Run FINOS Workspace on your machine and put your first widget on a dashboard.",
    tone: styles.quickStart,
  },
  {
    to: "/mcp",
    action: "Connect",
    label: "MCP Companion",
    text: "Let Claude Code, Claude Desktop or your IDE build dashboards and apps in your open tab.",
    tone: styles.mcp,
  },
  {
    to: "/user-guide",
    action: "Use",
    label: "User Guide",
    text: "Dashboards, widgets, apps, the Copilot, sharing and administration.",
    tone: styles.userGuide,
  },
  {
    to: "/technical-guide",
    action: "Run and build",
    label: "Technical Guide",
    text: "Build from source, deploy, configure, write backends, and the full reference.",
    tone: styles.technicalGuide,
  },
  {
    to: "/faq",
    action: "Ask",
    label: "FAQ",
    text: "Answers to the questions users, admins and developers ask most.",
    tone: styles.faq,
  },
  {
    to: "/contributing",
    action: "Contribute",
    label: "Contribute",
    text: "How to propose changes to FINOS Workspace.",
    tone: styles.contributing,
  },
  {
    to: "/plugins",
    action: "Extend",
    label: "Plugins",
    text: "Add new kinds of widgets with plugins.",
    tone: styles.plugins,
  },
];

export default function ModeGrid() {
  return (
    <div className={styles.grid}>
      {modes.map(({ to, action, label, text, tone }) => (
        <Link key={to} to={to} className={`${styles.card} ${tone}`}>
          <span className={styles.action}>{action}</span>
          <span className={styles.title}>{label}</span>
          <span className={styles.text}>{text}</span>
        </Link>
      ))}
    </div>
  );
}

import Link from "@docusaurus/Link";
import styles from "./styles.module.css";

const modes = [
  {
    to: "/tutorials",
    action: "Learn",
    label: "Tutorials",
    text: "Lessons that take you from a clean start to a working result. Start here if you are new.",
    tone: styles.tutorials,
  },
  {
    to: "/how-to",
    action: "Do",
    label: "How-to guides",
    text: "Steps for a specific goal, for readers who already know the basics.",
    tone: styles.howTo,
  },
  {
    to: "/reference",
    action: "Look up",
    label: "Reference",
    text: "The exact facts about the machinery, stated neutrally and completely.",
    tone: styles.reference,
  },
  {
    to: "/explanation",
    action: "Understand",
    label: "Explanation",
    text: "The background: how the parts fit together and why they are built this way.",
    tone: styles.explanation,
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

import Link from "@docusaurus/Link";
import styles from "./styles.module.css";

const tracks = [
  {
    number: 1,
    title: "Quick Start",
    text: "From nothing to a working dashboard, then let your AI tools build with you.",
    steps: [
      { to: "/quick-start", label: "Run FINOS Workspace", text: "Get the images, start it and connect a first backend." },
      { to: "/mcp", label: "Connect the MCP Companion", text: "Let Claude Code, Claude Desktop or your IDE build dashboards and apps." },
      { to: "/user-guide", label: "User Guide", text: "Dashboards, widgets, apps, the Agent, sharing and administration." },
    ],
  },
  {
    number: 2,
    title: "Technical Guide and Reference",
    text: "Deploy, configure, white-label and build on FINOS Workspace, and look up the exact facts.",
    steps: [
      { to: "/technical-guide", label: "Technical Guide", text: "Architecture, building a backend, building from source, deployment and white label." },
      { to: "/reference", label: "Reference", text: "Every setting, API, schema and protocol, generated from the code." },
    ],
  },
];

const more = [
  { to: "/faq", label: "FAQ", text: "Answers to the questions people ask most." },
  { to: "/contributing", label: "Contribute", text: "How to propose changes to FINOS Workspace." },
  { to: "/plugins", label: "Plugins", text: "Add new kinds of widgets." },
];

export default function TrackGrid() {
  return (
    <div className={styles.tracks}>
      {tracks.map((track) => (
        <section key={track.number} className={styles.track}>
          <header className={styles.header}>
            <span className={styles.badge}>Track {track.number}</span>
            <h2 className={styles.trackTitle}>{track.title}</h2>
            <p className={styles.trackText}>{track.text}</p>
          </header>
          <ol className={styles.steps}>
            {track.steps.map((step, index) => (
              <li key={step.to}>
                <Link to={step.to} className={styles.step}>
                  {track.steps.length > 2 && <span className={styles.number}>{index + 1}</span>}
                  <span className={styles.stepLabel}>{step.label}</span>
                  <span className={styles.stepText}>{step.text}</span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      ))}
      <div className={styles.more}>
        {more.map((item) => (
          <Link key={item.to} to={item.to} className={styles.moreCard}>
            <span className={styles.stepLabel}>{item.label}</span>
            <span className={styles.stepText}>{item.text}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

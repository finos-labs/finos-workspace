import { VITE_HELP_URL } from "~/constants";

export default function Page() {
  if (!VITE_HELP_URL) {
    return <p className="p-4">The documentation address is not configured.</p>;
  }
  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh" }}>
      <iframe
        src={VITE_HELP_URL}
        style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }}
        allowFullScreen
        title="Embedded Content"
      ></iframe>
    </div>
  );
}

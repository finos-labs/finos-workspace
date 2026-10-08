import packageJson from "../package.json";

const { VITE_ADDIN_BASE_URL, VITE_BACKEND_URL, VITE_HELP_URL, VITE_ENV } =
  import.meta.env;

const VERSION = `1.${packageJson.version}`;

// Excel functions of a local or development build get their own namespace suffix
const ADDIN_FUNCS_SUFFIX = VITE_ADDIN_BASE_URL?.includes("localhost")
  ? "LOCAL."
  : VITE_ADDIN_BASE_URL?.includes(".dev")
  ? "DEV."
  : "";

export {
  ADDIN_FUNCS_SUFFIX,
  VERSION,
  VITE_ADDIN_BASE_URL,
  VITE_BACKEND_URL,
  VITE_ENV,
  VITE_HELP_URL,
};

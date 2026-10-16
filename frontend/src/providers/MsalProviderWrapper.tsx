import { MsalProvider } from "@azure/msal-react";
import type { ReactNode } from "react";
import { getMsalInstance } from "~/lib/microsoft-auth-config";

export default function MsalProviderWrapper({ children }: { children: ReactNode }) {
  return <MsalProvider instance={getMsalInstance()}>{children}</MsalProvider>;
}

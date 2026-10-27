import {
  BrowserCacheLocation,
  type Configuration,
  LogLevel,
  type PopupRequest,
  PublicClientApplication,
} from "@azure/msal-browser";
import { getConfig } from "./runtimeConfig";

let _msalConfig: Configuration | null = null;
let _msalInstance: PublicClientApplication | null = null;

export function getMsalConfig(): Configuration {
  if (!_msalConfig) {
    const cfg = getConfig();
    _msalConfig = {
      auth: {
        clientId: cfg.authProviders.azureClientId ?? "",
        authority: `https://login.microsoftonline.com/${cfg.authProviders.azureTenantId ?? ""}`,
        redirectUri: window.location.origin,
      },
      cache: {
        cacheLocation: BrowserCacheLocation.MemoryStorage,
        temporaryCacheLocation: BrowserCacheLocation.MemoryStorage,
        storeAuthStateInCookie: false,
      },
      system: {
        loggerOptions: {
          loggerCallback: (level: LogLevel, message: string, containsPii: boolean) => {
            if (containsPii) {
              return;
            }
            switch (level) {
              case LogLevel.Error: {
                console.error(message);
                return;
              }
              case LogLevel.Info: {
                console.info(message);
                return;
              }
              case LogLevel.Verbose: {
                console.debug(message);
                return;
              }
              case LogLevel.Warning: {
                console.warn(message);
                return;
              }
            }
          },
          logLevel: LogLevel.Info,
        },
      },
    };
  }
  return _msalConfig;
}

export function getMsalInstance(): PublicClientApplication {
  _msalInstance ??= new PublicClientApplication(getMsalConfig());
  return _msalInstance;
}

export const loginRequest: PopupRequest = {
  scopes: ["User.Read"],
  prompt: "select_account",
};

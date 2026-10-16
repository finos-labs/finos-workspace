import "@jose-donato/react-grid-layout/css/styles.css";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  Fragment,
  lazy,
  memo,
  type ReactNode,
  Suspense,
  useEffect,
  useMemo,
} from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import queryClient from "./queryClient";
import "react-resizable/css/styles.css";
import { createBrowserRouter, Link, useRouteError } from "react-router-dom";
import Icon from "~/components/Icon";
import "./index.css";
import { registerSW } from "virtual:pwa-register";
import { ErrorBoundary } from "react-error-boundary";
import { useMcpAuthCallback } from "./components/AI/hooks/mcp/onMcpAuth";
import AuthRedirect from "./components/LayoutAuth/AuthRedirect";
import { TOOLTIP_OPEN_DELAY_MS, TOOLTIP_SKIP_DELAY_MS } from "./lib/constants";
import { getEnabledIdentityProviders } from "./lib/identityProviders";
import { removeRetiredBrowserSecrets } from "./lib/retiredBrowserSecrets";
import { getConfig } from "./lib/runtimeConfig";
import { useShallowThemeStore } from "./lib/state/theme";
import {
  applyBrandColors,
  applyFontFamily,
  applyWhiteLabelMeta,
} from "./utils/colorUtils";

// Auth provider lazy loading — only loads SDK when the provider is enabled
const LazyMsalProvider = lazy(() => import("./providers/MsalProviderWrapper"));
const LazyOktaProvider = lazy(() => import("./providers/OktaProviderWrapper"));
const LazyGoogleProvider = lazy(() => import("./providers/GoogleProviderWrapper"));

// Route-level lazy loading
const Setup2FA = lazy(() => import("./routes/2fa"));
const AppsPage = lazy(() => import("./routes/Apps"));
const AuthedAppNotFound = lazy(() => import("./routes/AuthedAppNotFound"));
const AdminHome = lazy(() => import("./routes/admin"));
const AdminEntities = lazy(() => import("./routes/admin/entities"));
const AdminAccountSettings = lazy(() => import("./routes/admin/account"));
const AdminApps = lazy(() => import("./routes/admin/apps"));
const AdminGroups = lazy(() => import("./routes/admin/roles"));
const AdminMarketplace = lazy(() => import("./routes/admin/marketplace"));

const AdminThemeSettings = lazy(() => import("./routes/admin/themeSettings"));
const AdminUsers = lazy(() => import("./routes/admin/users"));
const AILibrary = lazy(() => import("./routes/aiLibrary"));
const MenuHomePage = lazy(() => import("./routes/appHome"));
const ConnectionsPage = lazy(() => import("./routes/Connections"));
const HomePage = lazy(() => import("./routes/home"));
const LoginPage = lazy(() => import("./routes/login"));
const DataConnectors = lazy(() => import("./routes/newDataConnectors"));
const ResetPasswordPage = lazy(() => import("./routes/resetPassword"));
const Settings = lazy(() => import("./routes/settings"));
const TabPage = lazy(() => import("./routes/tab"));

const LayoutAdmin = lazy(() => import("./components/LayoutAdmin"));
const LayoutUnauth = lazy(() => import("./components/LayoutUnauth"));
const App = lazy(() => import("./components/LayoutAuth"));
const RootLayout = lazy(() => import("./components/RootLayout"));
const TooltipProvider = lazy(() =>
  import("./components/Tooltip").then((mod) => ({ default: mod.TooltipProvider })),
);

const MsalTokenRefresh = lazy(() => import("./components/MsalTokenRefresh"));
const OktaTokenRestore = lazy(() => import("./components/OktaTokenRestore"));

// Conditionally load react-scan for render scanning (stays build-time: dev-only tool)
if (
  typeof window !== "undefined" &&
  import.meta.env.VITE_ENABLE_RENDER_SCANNING === "true"
) {
  const script = document.createElement("script");
  script.src = "//unpkg.com/react-scan/dist/auto.global.js";
  script.crossOrigin = "anonymous";
  document.head.appendChild(script);
}

function OAuthCallback() {
  const error = useMcpAuthCallback();

  return (
    <div className="flex h-screen items-center justify-center">
      {error ? (
        <div className="max-w-md text-center text-light-900 dark:text-light-50">
          <h1 className="text-lg font-bold">Authentication Error</h1>
          <p className="mt-2.5 text-alert-error">{error}</p>
          <p className="mt-2.5">You can close this window.</p>
        </div>
      ) : (
        <div className="text-center text-light-900 dark:text-light-50">
          Authenticating… this window will close.
        </div>
      )}
    </div>
  );
}

function ErrorElement() {
  return (
    <div className="flex h-screen items-center justify-center">
      <div className="text-center text-light-900 dark:text-light-50">
        <Icon id="warning-icon" className="mx-auto h-10 w-10" />
        <h1 className="mt-4 text-lg font-bold uppercase tracking-wide">
          An error occurred
        </h1>
        <p className="mb-10 mt-2.5 text-xl">Something went wrong.</p>
        <Link to="/" className="ws-btn-tertiary h-10 text-sm">
          Go back home
        </Link>
      </div>
    </div>
  );
}

function RouterErrorElement() {
  const error = useRouteError() as Error;
  console.error(error);
  return <ErrorElement />;
}

const AuthGuard = memo(({ children }: { children?: ReactNode }) => {
  return useMemo(() => {
    const providers = getEnabledIdentityProviders();
    const Wrapper = providers.includes("microsoft") ? MsalTokenRefresh : Fragment;
    const OktaWrapper = providers.includes("okta") ? OktaTokenRestore : Fragment;

    return (
      <Fragment key="auth-guard">
        <AuthRedirect key="auth-redirect" />
        <Suspense fallback={null}>
          <Wrapper key="auth-wrapper">
            <OktaWrapper key="okta-wrapper">
              <S children={<App key="app">{children}</App>} />
            </OktaWrapper>
          </Wrapper>
        </Suspense>
      </Fragment>
    );
  }, [children]);
});

const S = ({ children }: { children: ReactNode }) => (
  <Suspense fallback={null}>{children}</Suspense>
);

const router = createBrowserRouter([
  {
    path: "/oauth",
    element: <S children={<LayoutUnauth />} />,
    errorElement: <RouterErrorElement />,
    children: [{ path: "callback", element: <OAuthCallback />, id: "oauth-callback" }],
  },
  {
    path: "/",
    element: <S children={<RootLayout />} />,
    errorElement: <RouterErrorElement />,
    children: [
      {
        path: "/",
        element: <S children={<LayoutUnauth />} />,
        children: [
          {
            index: true,
            element: <S children={<HomePage />} />,
            id: "home",
          },
          {
            path: "login",
            element: <S children={<LoginPage />} />,
            id: "login",
          },
          {
            path: "reset-password",
            element: <S children={<ResetPasswordPage />} />,
            id: "reset-password",
          },
        ],
      },
      {
        path: "/2fa",
        element: <S children={<Setup2FA />} />,
      },
      {
        path: "/app",
        element: <AuthGuard />,
        children: [
          {
            path: "",
            element: <S children={<AppsPage />} />,
          },
          {
            path: "help-documentation",
            element: <S children={<MenuHomePage />} />,
            id: "app-help-documentation",
          },
          {
            path: ":id",
            element: <S children={<TabPage />} />,
            id: "app-tab",
          },
          {
            path: "widgets",
            element: <S children={<DataConnectors />} />,
            id: "app-widgets",
          },
          {
            path: "ai",
            element: <S children={<AILibrary />} />,
            id: "app-ai",
          },
          {
            path: "settings",
            element: <S children={<Settings />} />,
            id: "app-settings",
          },
          {
            path: "connections",
            element: <S children={<ConnectionsPage />} />,
            id: "app-connections",
          },

          {
            path: "*",
            element: <S children={<AuthedAppNotFound />} />,
          },
        ],
      },
      {
        path: "/admin",
        element: <S children={<LayoutAdmin />} />,
        children: [
          {
            index: true,
            element: <S children={<AdminHome />} />,
            id: "admin-homepage",
          },
          {
            path: "users",
            element: <S children={<AdminUsers />} />,
            id: "admin-users",
          },
          {
            path: "entities",
            element: <S children={<AdminEntities />} />,
            id: "admin-entities",
          },
          {
            path: "roles",
            element: <S children={<AdminGroups />} />,
            id: "admin-roles",
          },
          {
            path: "apps",
            element: <S children={<AdminApps />} />,

            id: "admin-apps",
          },
          {
            path: "marketplace",
            element: <S children={<AdminMarketplace />} />,
            id: "admin-marketplace",
          },
          {
            path: "theme-settings",
            element: <S children={<AdminThemeSettings />} />,
            id: "admin-theme-settings",
          },
          {
            path: "account",
            element: <S children={<AdminAccountSettings />} />,
            id: "admin-account",
          },
        ],
      },
    ],
  },
]);

const AUTH_WRAPPERS = {
  microsoft: LazyMsalProvider,
  okta: LazyOktaProvider,
  google: LazyGoogleProvider,
} as const;

function Root() {
  const setTheme = useShallowThemeStore((state) => state.setTheme);

  const enabledProviders = useMemo(() => getEnabledIdentityProviders(), []);

  const RootContent = useMemo(() => {
    const content = (
      <QueryClientProvider client={queryClient}>
        <Suspense fallback={null}>
          <TooltipProvider
            delayDuration={TOOLTIP_OPEN_DELAY_MS}
            skipDelayDuration={TOOLTIP_SKIP_DELAY_MS}
          >
            <RouterProvider router={router} />
          </TooltipProvider>
        </Suspense>
      </QueryClientProvider>
    );
    return enabledProviders.reduce((content, provider) => {
      const Comp = AUTH_WRAPPERS[provider];
      return <Comp key={`${provider}-wrapper`}>{content}</Comp>;
    }, content);
  }, [enabledProviders]);

  useEffect(() => {
    const defaultTheme = getConfig().ui.defaultTheme || "dark";
    const localTheme = window.localStorage.getItem("theme") ?? defaultTheme;
    const theme = ["light", "dark"].includes(localTheme) ? localTheme : defaultTheme;
    setTheme(theme as "light" | "dark");
  }, []);

  return <Suspense fallback={null}>{RootContent}</Suspense>;
}

if ("serviceWorker" in navigator) {
  registerSW({ immediate: true });
}

function bootstrap() {
  removeRetiredBrowserSecrets();
  const config = getConfig();

  // Apply branding from runtime config
  if (config.whiteLabel.mainColor) {
    applyBrandColors(config.whiteLabel.mainColor);
  }
  if (config.whiteLabel.fontFamily) {
    applyFontFamily(config.whiteLabel.fontFamily);
  }

  // Override HTML meta tags from runtime config (no SEO needed for on-prem)
  applyWhiteLabelMeta(config.whiteLabel);

  const root = createRoot(document.getElementById("root") as HTMLElement);
  root.render(
    <ErrorBoundary
      FallbackComponent={ErrorElement}
      onError={(error) => {
        console.error(error);
      }}
    >
      <Root />
      <div id="dropdown-portal" />
    </ErrorBoundary>,
  );
}

bootstrap();

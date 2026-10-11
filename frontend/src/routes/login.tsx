import type { IPublicClientApplication } from "@azure/msal-browser";
import { zodResolver } from "@hookform/resolvers/zod";
import type { OktaAuth } from "@okta/okta-auth-js";
import type { CredentialResponse } from "@react-oauth/google";
import { useCallback, useEffect } from "react";
import { useForm } from "react-hook-form";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { useLocalStorage } from "usehooks-ts";
import { z } from "zod";
import {
  login as apiLogin,
  googleLogin,
  // githubLogin,
  microsoftLogin,
  oktaLogin,
  updatePassword,
} from "~/api/auth.api";
import { PasswordUpdateDialog } from "~/components/Auth/PasswordUpdateDialog";
import TOTPEnterDialog from "~/components/Auth/TOTPEnterDialog";
import TOTPSetDialog from "~/components/Auth/TOTPSetDialog";
import { Button } from "~/components/ds/atoms/Button";
import { Checkbox } from "~/components/ds/atoms/Checkbox";
import { FormInput } from "~/components/ds/atoms/Input";
import { Form, FormControl, FormField, FormItem } from "~/components/ds/molecules/Form";
import ErrorContent from "~/components/Forms/Error";
import { GoogleLogin } from "~/components/LayoutUnauth/GoogleLogin";
import MicrosoftLogin from "~/components/LayoutUnauth/MicrosoftLogin";
import OktaLogin from "~/components/LayoutUnauth/OktaLogin";
import { type StateDispatch, useStateReducer } from "~/hooks/useStateReducer";
import { getEnabledIdentityProviders } from "~/lib/identityProviders";
import { loginRequest } from "~/lib/microsoft-auth-config";
import { oktaLoginRequest } from "~/lib/okta-auth-config";
import { getConfig } from "~/lib/runtimeConfig";
import { useAppStore } from "~/lib/state/app";
import { useAuthStore, useShallowAuthStore } from "~/lib/state/auth";
import { useBackendConnectorStore } from "~/lib/state/backendConnector";
import { useCopilotStore } from "~/lib/state/copilot";
import { useEntityThemeStore } from "~/lib/state/entityTheme";
import { useFeatureFlagsStore } from "~/lib/state/featureFlags";
import { useMcpToolsStore } from "~/lib/state/mcpTools";
import { useSharedAppStore } from "~/lib/state/sharedApp";
import { useSkillsLibraryStore } from "~/lib/state/skillsLibrary";
import { useThemeStore } from "~/lib/state/theme";
import { useUserAppsStore } from "~/lib/state/userApps";
import {
  isLoggedIn,
  type Login2FAResponse,
  type LoginResponse,
} from "~/types/auth.type";
import { zodEmail, zodPassword } from "~/utils/zodForms";

const authenticationAllowEmailLoginFF = getConfig().authentication.allowEmailLogin;

const { supportEmail } = getConfig().contact;
const contactTarget = supportEmail ? `your admin (${supportEmail})` : "your admin";

export function getErrorMessage(
  statusCode: number,
  detail: string,
): undefined | string {
  switch (statusCode) {
    case 200:
      return undefined;
    case 202:
      return undefined;
    case 400:
      return `Your access has expired. Please contact ${contactTarget}.`;
    case 402: {
      if (detail === "User is not currently assigned a seat") {
        return "Your account is not assigned a seat. Please contact your admin to get assigned a seat.";
      }
      return `Your account does not have access. Please contact ${contactTarget}.`;
    }
    case 403: {
      if (detail === "Registration is disabled") return "Registration is disabled.";
      return "Please confirm your account to proceed.";
    }
    case 404:
      return "The provided credentials do not match any registered user account.";
    case 429:
      return "Too many requests. Please try again later.";
    case 503:
      return "Authentication service is currently unavailable. Please refresh the page or try again later.";
    case 500:
      return "An unexpected error occurred.";
    default:
      return "Invalid login credentials.";
  }
}

const UnexpectedError = `An unexpected error occurred. Please contact ${contactTarget} if it persists.`;

const loginSchema = z.object({
  email: zodEmail,
  password: zodPassword,
  remember: z.boolean(),
});

type loginForm = z.infer<typeof loginSchema>;

export type LoginState = {
  passwordLoading: boolean;
  oauthLoading: boolean;
  // githubLoading: boolean;
  showReset: boolean;
  showQR: null | string;
  enterQR: boolean;
  // If the user has logged in and doesnt need to
  // fill in any pop ups, we send them to the next page
  loggedIn: boolean;
  error: null | string;
};

export type LoginMethod = "password" | "google" | "microsoft" | "okta";

export default function LoginPage() {
  const [lastUsedMethod, setLastUsedMethod] = useLocalStorage<LoginMethod | null>(
    "lastUsedLoginMethod",
    null,
  );

  const { user, logout } = useShallowAuthStore((state) => ({
    user: state.user,
    logout: state.logout,
  }));

  const enabledProviders = getEnabledIdentityProviders();

  const [state, dispatch] = useStateReducer<LoginState>({
    passwordLoading: false,
    oauthLoading: false,
    // githubLoading: false,
    showReset: false,
    showQR: null,
    enterQR: false,
    loggedIn: user !== null,
    error: null,
  });

  const {
    form,
    onSubmit,
    onResetPasswordSubmit,
    onTOTPLoginSubmit,
    handleGoogleSuccess,
    handleMicrosoftSuccess,
    handleOktaSuccess,
    // handleGithubSuccess,
    // handleGithubError,
  } = useLogin({
    dispatch,
    state,
    setLastUsedMethod,
  });

  return (
    <div className="absolute top-0 left-0 w-full h-full overflow-y-auto hide-scrollbars">
      <div className="flex items-center justify-center min-h-screen w-full py-8 px-8">
        <div className="w-full max-w-[408px] p-10 rounded-lg bg-white">
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSubmit)}
              className="w-full space-y-6 force-light"
            >
              <img
                className="max-h-[130px] rounded-none"
                src={getConfig().whiteLabel.loginImage}
                alt="workspace"
              />
              {authenticationAllowEmailLoginFF && (
                <div>
                  <h1 className="text-light-800 body-lg-bold mb-1.5">
                    Sign in to your account
                  </h1>
                </div>
              )}

              {authenticationAllowEmailLoginFF && (
                <div className="mt-6 space-y-6">
                  <FormField
                    name="email"
                    render={({ field }) => (
                      <FormInput
                        type="email"
                        label="Email"
                        placeholder="Email address"
                        autoComplete="current-email"
                        clearable={false}
                        className="ws-autofill-light"
                        {...field}
                      />
                    )}
                  />
                  <FormField
                    name="password"
                    render={({ field }) => (
                      <FormInput
                        type="password"
                        label="Password"
                        autoComplete="current-password"
                        placeholder="Enter your password"
                        clearable={false}
                        {...field}
                      />
                    )}
                  />
                </div>
              )}
              <ErrorContent text={state.error} />
              {authenticationAllowEmailLoginFF && (
                <div className="flex justify-between text-nowrap">
                  <FormField
                    name="remember"
                    render={({ field }) => (
                      <FormItem className="[&_label]:text-light-800! body-xs-regular [&_label]:dark:text-light-800!">
                        <FormControl>
                          <Checkbox
                            label="Remember me"
                            {...field}
                            className="border-light-600 dark:border-light-600 hover:border-light-700! dark:hover:border-light-700! dark:data-[state=checked]:border-brand-main! data-[state=checked]:border-brand-main"
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>
              )}
              <div className="mt-[42px] flex flex-col gap-4 items-center justify-center">
                {authenticationAllowEmailLoginFF && (
                  <div className="relative w-full max-w-[240px]">
                    <Button
                      className="w-full"
                      variant="primary"
                      type="submit"
                      size="md"
                      loading={state.passwordLoading}
                      disabled={state.passwordLoading}
                    >
                      Login
                    </Button>
                    {lastUsedMethod === "password" && <LastUsedMethod />}
                  </div>
                )}
                {enabledProviders.length > 0 && (
                  <>
                    {authenticationAllowEmailLoginFF && (
                      <span className="text-dark-100 text-xs px-4">or</span>
                    )}
                    <div className="flex flex-col gap-4 w-full max-w-[240px]">
                      {enabledProviders.includes("google") && (
                        <div className="relative w-full notranslate">
                          <GoogleLogin
                            dispatch={dispatch}
                            handleGoogleSuccess={handleGoogleSuccess}
                            state={state}
                          />
                          {lastUsedMethod === "google" && <LastUsedMethod />}
                        </div>
                      )}
                      {enabledProviders.includes("microsoft") && (
                        <div className="relative w-full notranslate">
                          <MicrosoftLogin handleLogin={handleMicrosoftSuccess} />
                          {lastUsedMethod === "microsoft" && <LastUsedMethod />}
                        </div>
                      )}
                      {enabledProviders.includes("okta") && (
                        <div className="relative w-full notranslate">
                          <OktaLogin handleLogin={handleOktaSuccess} />
                          {lastUsedMethod === "okta" && <LastUsedMethod />}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </form>
          </Form>
        </div>
      </div>
      <PasswordUpdateDialog
        open={state.showReset && !state.showQR}
        setOpen={(value: boolean) => dispatch({ showReset: value })}
        handleSubmit={onResetPasswordSubmit}
      />
      <TOTPSetDialog
        open={state.showQR}
        setOpen={(value) => dispatch({ showQR: value ?? null })}
        handleSubmit={onTOTPLoginSubmit}
        onCancel={() =>
          dispatch({
            showQR: null,
            passwordLoading: false,
            oauthLoading: false,
          })
        }
      />
      <TOTPEnterDialog
        open={state.enterQR}
        setOpen={(value: boolean) => dispatch({ enterQR: value })}
        handleSubmit={onTOTPLoginSubmit}
        onCancel={logout}
      />
    </div>
  );
}

function handle2FAResponse(response: Login2FAResponse): Partial<LoginState> {
  const { access_token = null } = response;
  if (access_token) useAuthStore.getState().updateUser({ token: access_token });

  return { enterQR: !access_token, showQR: access_token };
}

function useLogin(props: {
  dispatch: StateDispatch<LoginState>;
  state: LoginState;
  setLastUsedMethod: (method: LoginMethod) => void;
}) {
  const { dispatch, state, setLastUsedMethod } = props;
  const [searchParams] = useSearchParams();
  const urlError = searchParams.get("error");
  const navigate = useNavigate();

  const authStore = useShallowAuthStore((state) => ({
    lastVisitedPage: state.lastVisitedPage,
  }));

  const form = useForm({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: searchParams.get("email") || "",
      password: "",
      remember: false,
    },
  });

  useEffect(() => {
    if (urlError) toast.error("Error", { description: urlError });
  }, [urlError]);

  useEffect(() => {
    if (state.loggedIn && !state.showQR && !state.showReset) {
      const nextPage = authStore.lastVisitedPage;
      navigate(nextPage);
    }
  }, [
    state.loggedIn,
    state.showQR,
    state.showReset,
    navigate,
    authStore.lastVisitedPage,
  ]);

  const onResetPasswordSubmit = useCallback(
    async (newPassword: string): Promise<number> => {
      const { password: currentPassword } = form.getValues();
      return await updatePassword(currentPassword, newPassword);
    },
    [form.getValues],
  );

  const captureError = useCallback(
    (error: Error) => {
      console.error(error);
      dispatch({
        error: UnexpectedError,
        passwordLoading: false,
        oauthLoading: false,
        showQR: null,
        enterQR: false,
      });
    },
    [dispatch],
  );

  const onTOTPLoginSubmit = useCallback(
    async (token: number): Promise<number> => {
      dispatch({ error: null });
      const { email, password, remember } = form.getValues();
      const response = await apiLogin(email, password, remember, token);
      if (isLoggedIn(response)) {
        loginSuccess(response)
          .then(dispatch)
          .catch((error) => {
            captureError(error);
          });
      }
      return response.status ?? 500;
    },
    [form.getValues, captureError],
  );

  const onSubmit = useCallback(
    async (values: loginForm) => {
      dispatch({ passwordLoading: true, error: null });
      const startTime = performance.now();

      const second = await apiLogin(values.email, values.password, values.remember);

      const endTime = performance.now();
      const loginTime = endTime - startTime;
      if (import.meta.env.DEV)
        console.log(`Login took ${loginTime.toFixed(2)} milliseconds`);

      if (isLoggedIn(second)) {
        setLastUsedMethod("password");
        return loginSuccess(second)
          .then(dispatch)
          .catch((error) => {
            captureError(error);
          });
      }

      if (second.status === 202) {
        setLastUsedMethod("password");
        return dispatch({ ...handle2FAResponse(second), passwordLoading: false });
      }

      const cleanDetail = second?.detail;
      dispatch({
        error: getErrorMessage(second.status, cleanDetail),
        passwordLoading: false,
      });
    },
    [dispatch, captureError, setLastUsedMethod],
  );

  const handleGoogleSuccess = useCallback(
    async (credentialResponse: CredentialResponse) => {
      try {
        const startTime = performance.now();

        if (!credentialResponse.credential) return;
        const response = await googleLogin(credentialResponse.credential);

        const endTime = performance.now();
        const loginTime = endTime - startTime;
        if (import.meta.env.DEV)
          console.log(`Login took ${loginTime.toFixed(2)} milliseconds`);

        if (isLoggedIn(response)) {
          setLastUsedMethod("google");
          return loginSuccess(response)
            .then(dispatch)
            .catch((error) => {
              captureError(error);
            });
        }

        if (response.status === 202) {
          setLastUsedMethod("google");
          return dispatch({ ...handle2FAResponse(response), oauthLoading: false });
        }

        const cleanDetail = response?.detail;
        dispatch({
          error: getErrorMessage(response.status, cleanDetail),
          oauthLoading: false,
        });
      } catch (error) {
        console.error(error);
        dispatch({
          oauthLoading: false,
          error: "An unexpected error occurred. Please try again or contact support.",
        });
      }
    },
    [dispatch, captureError, setLastUsedMethod],
  );

  const handleMicrosoftSuccess = useCallback(
    async (instance: IPublicClientApplication) => {
      try {
        const res = await instance.loginPopup(loginRequest);
        const idToken = res?.idToken;

        const response = await microsoftLogin(res?.accessToken);

        if (isLoggedIn(response)) {
          // we need to save the idToken so we can send later to custom backends
          response.microsoftIdToken = idToken;
          // Remember which MSAL account this session belongs to; the silent
          // token refresh relies on it instead of matching the backend email
          // (which comes from Graph `mail` and can differ from the MSAL UPN)
          instance.setActiveAccount(res.account);

          setLastUsedMethod("microsoft");
          return loginSuccess(response)
            .then(dispatch)
            .catch((error) => {
              captureError(error);
            });
        }

        if (response.status === 202) {
          setLastUsedMethod("microsoft");
          return dispatch({ ...handle2FAResponse(response), oauthLoading: false });
        }

        const cleanDetail = response?.detail;
        dispatch({
          error: getErrorMessage(response.status, cleanDetail),
          oauthLoading: false,
        });
      } catch (error) {
        console.error(error);
        dispatch({
          oauthLoading: false,
          error: "An unexpected error occurred. Please try again or contact support.",
        });
      }
    },
    [dispatch, captureError, setLastUsedMethod],
  );

  const handleOktaSuccess = useCallback(
    async (oktaAuth: OktaAuth) => {
      try {
        const tokenResponse = await oktaAuth.token.getWithPopup(oktaLoginRequest);
        const accessToken = tokenResponse.tokens.accessToken?.accessToken;
        const idToken = tokenResponse.tokens.idToken?.idToken;

        if (!accessToken) {
          throw new Error("Failed to get access token from Okta");
        }

        const response = await oktaLogin(accessToken);

        if (isLoggedIn(response)) {
          // we need to save the idToken so we can send later to custom backends
          response.oktaIdToken = idToken;

          setLastUsedMethod("okta");
          return loginSuccess(response)
            .then(dispatch)
            .catch((error) => {
              captureError(error);
            });
        }

        if (response.status === 202) {
          setLastUsedMethod("okta");
          return dispatch({ ...handle2FAResponse(response), oauthLoading: false });
        }

        const cleanDetail = response?.detail;
        dispatch({
          error: getErrorMessage(response.status, cleanDetail),
          oauthLoading: false,
        });
      } catch (error) {
        console.error(error);
        dispatch({
          oauthLoading: false,
          error: "An unexpected error occurred. Please try again or contact support.",
        });
      }
    },
    [dispatch, captureError, setLastUsedMethod],
  );

  return {
    form,
    onSubmit,
    onResetPasswordSubmit,
    onTOTPLoginSubmit,
    handleGoogleSuccess,
    handleMicrosoftSuccess,
    handleOktaSuccess,
  };
}

export function LastUsedMethod() {
  return (
    <div className="absolute -right-20 top-1/2 -translate-y-1/2 flex items-center justify-center">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="8"
        height="16"
        viewBox="0 0 8 16"
        fill="none"
        className="absolute -left-2"
      >
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M1.41421 9.41421C0.633164 8.63316 0.633165 7.36684 1.41421 6.58579L8 0V16L1.41421 9.41421Z"
          fill="#36363F"
        />
      </svg>
      <span className="bg-[#36363F] text-white text-xs px-2 py-1">Last Used</span>
    </div>
  );
}

export async function loginSuccess(data: LoginResponse) {
  // Save user information in the auth store
  useAuthStore.getState().login(data);
  const user = data.user;

  useFeatureFlagsStore
    .getState()
    .setFeatureFlagsAndUsage(data.feature_entitlements, data.usage);

  if (data.entity_theme_settings)
    useEntityThemeStore.getState().updateThemeSettings(data.entity_theme_settings);

  const dashboardsData = data.dash_sync;
  useAppStore.getState().updateRemoteItems(dashboardsData.owned);
  useSharedAppStore.getState().updateOnlySharedItems({
    shared: dashboardsData.shared ?? {},
    entityShared: dashboardsData.entity_shared ?? {},
  });
  useMcpToolsStore.getState().updateServers(data.mcp_servers);
  useUserAppsStore.getState().updateUserApps(data.user_apps || {});
  useSkillsLibraryStore.getState().updateSkills(data.user_skills || []);

  try {
    const userChats = data.copilot_chats;
    if (userChats && Array.isArray(userChats)) {
      if (userChats.length > 0) {
        useCopilotStore.getState().updateChats(userChats, {
          customCopilots: data.custom_copilots,
          questionsHistory: data.questions_history,
        });
      } else {
        console.warn("No valid chats found in user data");
      }
    } else {
      console.warn("Invalid or empty chats data received");
    }
  } catch (err) {
    console.error("Error fetching user chats:", err);
  }

  useBackendConnectorStore.getState().updateBackendConnector({
    storedFiles: user.file_widgets || [],
    apiSources: user.api_sources || [],
    widgetMetadata: user.widget_metadata || [],
  });

  useThemeStore.getState().updateThemeState({ ...user.display_settings });

  const showQR = data.force_2fa ? data.access_token : undefined;
  return {
    showQR,
    showReset: data.temporary_password,
    loggedIn: true,
  };
}

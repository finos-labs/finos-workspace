import { zodResolver } from "@hookform/resolvers/zod";
import type { CredentialResponse } from "@react-oauth/google";
import { useCallback, useEffect } from "react";
import { useForm } from "react-hook-form";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { z } from "zod";
import {
  activateTotp,
  login as apiLogin,
  getSession,
  googleLogin,
  type ServerSignInProvider,
  startSignIn,
  updatePassword,
} from "~/api/auth.api";
import { errorMessage } from "~/api/errors";
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
import { getConfig } from "~/lib/runtimeConfig";
import { useAccessStore } from "~/lib/state/access";
import { useAppStore } from "~/lib/state/app";
import { useAuthStore, useShallowAuthStore } from "~/lib/state/auth";
import { useBackendConnectorStore } from "~/lib/state/backendConnector";
import { useCopilotStore } from "~/lib/state/copilot";
import { useEntityThemeStore } from "~/lib/state/entityTheme";
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

const { allowEmailLogin: authenticationAllowEmailLoginFF } = getConfig().authentication;

const { supportEmail } = getConfig().contact;
const contactTarget = supportEmail ? `your admin (${supportEmail})` : "your admin";

export function getErrorMessage(
  statusCode: number,
  detail: string,
): undefined | string {
  switch (statusCode) {
    case 200:
      return undefined;
    case 403: {
      if (detail === "Registration is disabled") return "Registration is disabled.";
      if (!detail || detail === "User is not confirmed")
        return "Please confirm your account to proceed.";
      return detail;
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
  showReset: boolean;
  showQR: boolean;
  enterQR: boolean;
  loggedIn: boolean;
  error: null | string;
};

export default function LoginPage() {
  const { user, logout, restoreSession } = useShallowAuthStore((state) => ({
    user: state.user,
    logout: state.logout,
    restoreSession: state.restoreSession,
  }));

  const enabledProviders = getEnabledIdentityProviders();

  const [state, dispatch] = useStateReducer<LoginState>({
    passwordLoading: false,
    oauthLoading: false,
    showReset: false,
    showQR: false,
    enterQR: false,
    loggedIn: user !== null,
    error: null,
  });

  useEffect(() => {
    if (user) return;
    let active = true;
    restoreSession().then((signedIn) => {
      if (active && signedIn) dispatch({ loggedIn: true });
    });
    return () => {
      active = false;
    };
  }, []);

  const {
    form,
    onSubmit,
    onResetPasswordSubmit,
    onTOTPLoginSubmit,
    onTOTPEnroll,
    handleGoogleSuccess,
    handleProviderSignIn,
  } = useLogin({
    dispatch,
    state,
  });

  return (
    <div className="absolute top-0 left-0 w-full h-full overflow-y-auto hide-scrollbars">
      <div className="flex items-center justify-center min-h-screen w-full py-8 px-8">
        <div className="w-full max-w-[408px] p-10 rounded-lg bg-white border border-light-200 shadow-[0_8px_30px_rgba(7,24,32,0.12)]">
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSubmit)}
              className="w-full space-y-6 force-light"
            >
              <img
                className="mx-auto block h-auto w-full max-w-[220px] object-contain"
                src={getConfig().whiteLabel.loginImage}
                alt="FINOS Workspace"
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
              {authenticationAllowEmailLoginFF && (
                <p className="text-light-800 body-xs-regular">
                  Forgot your password? Ask {contactTarget} to reset your password.
                </p>
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
                        </div>
                      )}
                      {enabledProviders.includes("microsoft") && (
                        <div className="relative w-full notranslate">
                          <MicrosoftLogin
                            handleLogin={() => handleProviderSignIn("microsoft")}
                          />
                        </div>
                      )}
                      {enabledProviders.includes("okta") && (
                        <div className="relative w-full notranslate">
                          <OktaLogin handleLogin={() => handleProviderSignIn("okta")} />
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
        setOpen={(showQR) => dispatch({ showQR })}
        activate={onTOTPEnroll}
        onCancel={() =>
          dispatch({
            showQR: false,
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
  return response.two_factor_required ? { showQR: true } : { enterQR: true };
}

function useLogin(props: { dispatch: StateDispatch<LoginState>; state: LoginState }) {
  const { dispatch, state } = props;
  const [searchParams] = useSearchParams();
  const urlError = searchParams.get("error");
  const urlStep = searchParams.get("step");
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
    if (urlStep === "totp-enroll") dispatch({ showQR: true });
  }, [urlStep, dispatch]);

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
        showQR: false,
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

  const onTOTPEnroll = useCallback(
    async (token: number): Promise<number> => {
      dispatch({ error: null });
      const status = await activateTotp(token, {
        remember: form.getValues("remember"),
      });
      if (status !== 200) return status;
      const session = await getSession();
      if (!session) {
        dispatch({ error: UnexpectedError });
        return 500;
      }
      useAuthStore.getState().startSession(session);
      dispatch({ loggedIn: true, showReset: session.temporary_password ?? false });
      return status;
    },
    [dispatch, form.getValues],
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
        return loginSuccess(second)
          .then(dispatch)
          .catch((error) => {
            captureError(error);
          });
      }

      if (second.status === 202) {
        return dispatch({ ...handle2FAResponse(second), passwordLoading: false });
      }

      const cleanDetail = second?.detail;
      dispatch({
        error: getErrorMessage(second.status, cleanDetail),
        passwordLoading: false,
      });
    },
    [dispatch, captureError],
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
          return loginSuccess(response)
            .then(dispatch)
            .catch((error) => {
              captureError(error);
            });
        }

        if (response.status === 202) {
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
    [dispatch, captureError],
  );

  const handleProviderSignIn = useCallback(
    async (provider: ServerSignInProvider) => {
      dispatch({ error: null });
      try {
        window.location.assign(await startSignIn(provider));
      } catch (error) {
        console.error(error);
        dispatch({ error: errorMessage(error, UnexpectedError) });
      }
    },
    [dispatch],
  );

  return {
    form,
    onSubmit,
    onResetPasswordSubmit,
    onTOTPLoginSubmit,
    onTOTPEnroll,
    handleGoogleSuccess,
    handleProviderSignIn,
  };
}

export async function loginSuccess(data: LoginResponse) {
  useAuthStore.getState().login(data);
  const user = data.user;

  useAccessStore.getState().setAccessAndUsage(data.access, data.usage);

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

  return {
    showQR: data.force_2fa,
    showReset: data.temporary_password,
    loggedIn: true,
  };
}

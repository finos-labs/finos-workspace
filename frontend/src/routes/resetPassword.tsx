import { zodResolver } from "@hookform/resolvers/zod";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useLocation, useNavigate } from "react-router-dom";
import { resetPassword } from "~/api/auth.api";
import { Button } from "~/components/ds/atoms/Button";
import { FormInput } from "~/components/ds/atoms/Input";
import { Form, FormField } from "~/components/ds/molecules/Form";
import ErrorContent from "~/components/Forms/Error";
import { getConfig } from "~/lib/runtimeConfig";
import { invalidPassword, type resetForm, resetSchema } from "~/utils/zodForms";

const NO_LINK = "This link is not complete. Ask your admin for a new one.";

function resetError(status: number, detail?: string): string {
  switch (status) {
    case 400:
      return detail ?? NO_LINK;
    case 422:
      return invalidPassword;
    case 429:
      return "Too many requests. Please try again later.";
    default:
      return "An unexpected error occurred.";
  }
}

export default function ResetPasswordPage() {
  const { hash, pathname } = useLocation();
  const navigate = useNavigate();
  const [token, setToken] = useState(() => hash.slice(1));
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(token ? null : NO_LINK);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!hash) return;
    setToken(hash.slice(1));
    setDone(false);
    setError(null);
    navigate({ pathname }, { replace: true });
  }, [hash]);

  const form = useForm({
    resolver: zodResolver(resetSchema),
    defaultValues: { password: "", confirm: "" },
  });

  const onSubmit = useCallback(
    async (values: resetForm) => {
      setLoading(true);
      setError(null);
      const { status, detail } = await resetPassword(token, values.password);
      setLoading(false);
      if (status === 200) setDone(true);
      else setError(resetError(status, detail));
    },
    [token],
  );

  return (
    <div className="absolute top-0 left-0 w-full h-full overflow-y-auto hide-scrollbars">
      <div className="flex items-center justify-center min-h-screen w-full py-8 px-8">
        <div className="w-full max-w-[408px] p-10 rounded-lg bg-white border border-light-200 shadow-[0_8px_30px_rgba(7,24,32,0.12)] force-light space-y-6">
          <img
            className="max-h-[130px] rounded-none"
            src={getConfig().whiteLabel.loginImage}
            alt="workspace"
          />
          <h1 className="text-light-800 body-lg-bold">Set a new password</h1>
          {done ? (
            <>
              <p className="text-light-800 body-sm-regular">
                Your password is set. Sign in with it.
              </p>
              <Button
                className="w-full"
                variant="primary"
                size="md"
                onClick={() => navigate("/login", { replace: true })}
              >
                Sign in
              </Button>
            </>
          ) : (
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="w-full space-y-6">
                <FormField
                  name="password"
                  render={({ field }) => (
                    <FormInput
                      type="password"
                      label="New Password"
                      placeholder="Enter your new password"
                      autoComplete="new-password"
                      clearable={false}
                      {...field}
                    />
                  )}
                />
                <FormField
                  name="confirm"
                  render={({ field }) => (
                    <FormInput
                      type="password"
                      label="Confirm Password"
                      placeholder="Confirm your new password"
                      autoComplete="new-password"
                      clearable={false}
                      {...field}
                    />
                  )}
                />
                {!form.formState.errors.password && (
                  <p className="text-light-800 body-xs-regular">{invalidPassword}</p>
                )}
                <ErrorContent text={error} />
                <Button
                  className="w-full"
                  variant="primary"
                  type="submit"
                  size="md"
                  loading={loading}
                  disabled={loading || !token}
                >
                  Set password
                </Button>
              </form>
            </Form>
          )}
        </div>
      </div>
    </div>
  );
}

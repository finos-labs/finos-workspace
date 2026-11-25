import { zodResolver } from "@hookform/resolvers/zod";
import { useCallback, useState } from "react";
import { useForm } from "react-hook-form";
import { Navigate, useNavigate } from "react-router-dom";
import { requestSignup } from "~/api/auth.api";
import { Button } from "~/components/ds/atoms/Button";
import { FormInput } from "~/components/ds/atoms/Input";
import { Form, FormField } from "~/components/ds/molecules/Form";
import ErrorContent from "~/components/Forms/Error";
import { getConfig } from "~/lib/runtimeConfig";
import { type signupForm, signupSchema } from "~/utils/zodForms";

function signupError(status: number): string {
  switch (status) {
    case 403:
      return "Registration is disabled.";
    case 404:
      return "Signup is not available.";
    case 422:
      return "Check the email address and try again.";
    case 429:
      return "Too many requests. Please try again later.";
    case 503:
      return "Signup is not set up. Ask your admin.";
    default:
      return "An unexpected error occurred.";
  }
}

export default function SignupPage() {
  const navigate = useNavigate();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const form = useForm({
    resolver: zodResolver(signupSchema),
    defaultValues: { email: "", firstName: "", lastName: "" },
  });

  const onSubmit = useCallback(async (values: signupForm) => {
    setLoading(true);
    setError(null);
    const { status } = await requestSignup(
      values.email,
      values.firstName.trim(),
      values.lastName.trim(),
    );
    setLoading(false);
    if (status === 202) setSentTo(values.email);
    else setError(signupError(status));
  }, []);

  if (!getConfig().authentication.allowSignup) return <Navigate to="/login" replace />;

  return (
    <div className="absolute top-0 left-0 w-full h-full overflow-y-auto hide-scrollbars">
      <div className="flex items-center justify-center min-h-screen w-full py-8 px-8">
        <div className="w-full max-w-[408px] p-10 rounded-lg bg-white border border-light-200 shadow-[0_8px_30px_rgba(7,24,32,0.12)] force-light space-y-6">
          <img
            className="max-h-[130px] rounded-none"
            src={getConfig().whiteLabel.loginImage}
            alt="workspace"
          />
          <h1 className="text-light-800 body-lg-bold">Create an account</h1>
          {sentTo ? (
            <p className="text-light-800 body-sm-regular">
              If {sentTo} can get an account, an email with a link to finish it is on
              its way. The link works once and expires after a day.
            </p>
          ) : (
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="w-full space-y-6">
                <FormField
                  name="email"
                  render={({ field }) => (
                    <FormInput
                      type="email"
                      label="Email"
                      placeholder="Email address"
                      autoComplete="email"
                      clearable={false}
                      className="ws-autofill-light"
                      {...field}
                    />
                  )}
                />
                <FormField
                  name="firstName"
                  render={({ field }) => (
                    <FormInput
                      label="First name"
                      placeholder="First name (optional)"
                      autoComplete="given-name"
                      clearable={false}
                      {...field}
                    />
                  )}
                />
                <FormField
                  name="lastName"
                  render={({ field }) => (
                    <FormInput
                      label="Last name"
                      placeholder="Last name (optional)"
                      autoComplete="family-name"
                      clearable={false}
                      {...field}
                    />
                  )}
                />
                <ErrorContent text={error} />
                <Button
                  className="w-full"
                  variant="primary"
                  type="submit"
                  size="md"
                  loading={loading}
                  disabled={loading}
                >
                  Send the link
                </Button>
              </form>
            </Form>
          )}
          <Button
            className="w-full"
            variant="secondary"
            size="md"
            onClick={() => navigate("/login")}
          >
            Back to sign in
          </Button>
        </div>
      </div>
    </div>
  );
}

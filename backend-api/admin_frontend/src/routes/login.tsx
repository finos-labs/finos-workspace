import { zodResolver } from "@hookform/resolvers/zod";
import { FormField, FormInput } from "ui/Form";
import { useForm } from "react-hook-form";
import { ManagerForm } from "components/formItems";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "utils/auth";
import { apiLogin } from "utils/requests";
import { z } from "zod";

/** An authenticator code as typed: six digits, which apps often show split by a space. */
function codeDigits(code: string): string {
  return code.replace(/\s/g, "");
}

/** The sign-in form; the authenticator code is required once the API has asked for it. */
function loginSchema(codeNeeded: boolean) {
  return z.object({
    email: z.string().email().min(1, "This field is required"),
    password: z.string().min(8, "The password must be at least 8 characters long"),
    code: codeNeeded
      ? z
          .string()
          .refine(
            (code) => /^\d{6}$/.test(codeDigits(code)),
            "Enter the 6-digit code from your authenticator app",
          )
      : z.string(),
  });
}
type TLoginSchema = z.infer<ReturnType<typeof loginSchema>>;

export default function Login(): JSX.Element {
  const [warning, setWarning] = useState("");
  /** Whether the API asked for the code of the account's authenticator. */
  const [codeNeeded, setCodeNeeded] = useState(false);
  const { login } = useAuthStore();
  const navigate = useNavigate();

  const form = useForm<TLoginSchema>({
    resolver: zodResolver(loginSchema(codeNeeded)),
    defaultValues: { email: "", password: "", code: "" },
  });

  useEffect(() => {
    if (codeNeeded) form.setFocus("code");
  }, [codeNeeded, form]);

  const handleSubmit = async (values: TLoginSchema): Promise<void> => {
    const result = await apiLogin({
      email: values.email,
      password: values.password,
      // The API pads the number back to six digits, so a leading zero is kept
      totpToken: codeNeeded ? Number(codeDigits(values.code)) : undefined,
    });
    if (result.outcome === "signed-in") {
      login(result.user, navigate);
      return;
    }
    form.setValue("code", "");
    if (result.outcome === "code-needed") {
      setWarning("");
      setCodeNeeded(true);
      return;
    }
    setWarning(result.message);
  };

  return (
    <div className="min-h-screen bg-surface-page">
      <div className="ws-page-container flex justify-center pt-16">
        <div className="w-full max-w-2xl">
          <div className="mb-4">
            <h1 className="ws-admin-title">Admin Sign In</h1>
            <p className="ws-admin-subtitle">
              Use your admin credentials to manage entities, users, and permission maps.
            </p>
          </div>
      <ManagerForm onSubmit={handleSubmit} warning={warning} form={form}>
        <FormField
          name="email"
          control={form.control}
          render={({ field }) => {
            return <FormInput label="Email" {...field} />;
          }}
        />
        <FormField
          name="password"
          control={form.control}
          render={({ field }) => {
            return <FormInput type="password" label="Password" {...field} />;
          }}
        />
        {codeNeeded && (
          <>
            <FormField
              name="code"
              control={form.control}
              render={({ field }) => {
                return (
                  <FormInput
                    label="Authenticator code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    {...field}
                  />
                );
              }}
            />
            <p className="text-xs text-ds-text-subtitle">
              This account uses an authenticator. Enter the 6-digit code it shows now.
            </p>
          </>
        )}
            <button type="submit" className="ws-btn-blue mt-2">Sign In</button>
      </ManagerForm>
        </div>
      </div>
    </div>
  );
}

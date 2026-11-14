import { Navigate } from "react-router-dom";
import { confirmSignup } from "~/api/auth.api";
import { getConfig } from "~/lib/runtimeConfig";
import { SetPasswordPage } from "./resetPassword";

export default function SignupConfirmPage() {
  if (!getConfig().authentication.allowSignup) return <Navigate to="/login" replace />;
  return (
    <SetPasswordPage
      title="Choose your password"
      noLink="This link is not complete. Sign up again to get a new one."
      doneText="Your account is ready. Sign in with your email address and password."
      submit={confirmSignup}
    />
  );
}

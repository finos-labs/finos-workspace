import { Input } from "~/components/ds/atoms/Input";

/** The link an admin gives a user to set their password with, and when it stops working. */
export default function PasswordLink({
  link,
  expiresAt,
}: {
  link: string;
  expiresAt: string;
}) {
  return (
    <>
      <p>
        Give them this link to set their password. It works once, until{" "}
        {new Date(expiresAt).toLocaleString()}.
      </p>
      <Input
        size="sm"
        readOnly
        copiable
        value={link}
        aria-label="Password link"
        inputClassName="font-mono"
      />
    </>
  );
}

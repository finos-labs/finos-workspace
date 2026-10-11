import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  getUserWebAccess,
  patchUserWebAccess,
  type UserWebAccess,
} from "~/api/admin.api";
import { Checkbox } from "../ds/atoms/Checkbox";

interface Props {
  userUuid: string;
}

const SWITCHES: { name: keyof UserWebAccess; label: string; hint: string }[] = [
  {
    name: "search_web",
    label: "Search the web",
    hint: "The Copilot's tool for finding pages and news (SEARCH_WEB).",
  },
  {
    name: "fetch_from_web",
    label: "Read pages from the web",
    hint: "The Copilot's tool for reading a page, and for reading a link the user writes (FETCH_FROM_WEB).",
  },
];

/**
 * What the Copilot may do on the web for one user. It starts as the organization's setting; what an
 * administrator sets here is the user's own, and a later change of the organization's does not take it away.
 * Switching a tool off takes it from the Copilot at once, whatever the user's roles grant.
 */
export default function AdminUserWebAccess({ userUuid }: Props) {
  const queryClient = useQueryClient();
  const queryKey = ["admin", "webAccess", userUuid];
  const { data, isPending, isError } = useQuery({
    queryKey,
    queryFn: () => getUserWebAccess(userUuid),
    retry: false,
  });

  const mutation = useMutation({
    mutationFn: (change: Partial<UserWebAccess>) =>
      patchUserWebAccess(userUuid, change),
    onSuccess: () => {
      toast.success("Web access updated");
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (err: { response?: { data?: { detail?: string } } }) => {
      toast.error(err?.response?.data?.detail ?? "Something went wrong");
    },
  });

  if (isError) {
    return (
      <p className="text-ds-text-caption" data-testid="web-access-unavailable">
        This user has no entitlement yet, so there is nothing to set.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="web-access">
      {SWITCHES.map(({ name, label, hint }) => (
        <div key={name} className="flex flex-col gap-0.5">
          <Checkbox
            label={label}
            // Empty is on: an entitlement written before these existed has neither set.
            checked={(data?.[name] ?? true) !== false}
            disabled={isPending || mutation.isPending}
            onCheckedChange={(checked) => {
              if (typeof checked === "boolean") mutation.mutate({ [name]: checked });
            }}
          />
          <span className="body-xs-regular text-ds-text-caption pl-5">{hint}</span>
        </div>
      ))}
    </div>
  );
}

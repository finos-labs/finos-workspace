import * as TabsPrimitive from "@radix-ui/react-tabs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { toast } from "sonner";
import {
  decideShareRequest,
  getShareRequests,
  type ShareRequest,
  type ShareRequestUser,
} from "~/api/admin.api";
import { errorMessage } from "~/api/errors";
import type { DataTableColumn } from "~/components/ds/molecules/DataTable";
import { DataTable } from "~/components/ds/molecules/DataTable";
import { Button } from "../ds/atoms/Button";

type Decision = "approve" | "decline";

export const SHARE_REQUESTS_QUERY_KEY = ["shareRequests"];

const getRequestId = (request: ShareRequest) => request.uuid;

function Person({ user }: { user: ShareRequestUser }) {
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ");
  return (
    <span className="flex flex-col">
      <span className="body-xs-medium">{name || user.email}</span>
      {name && (
        <span className="body-xs-regular text-ds-text-caption">{user.email}</span>
      )}
    </span>
  );
}

/**
 * The shares that developers of the organization asked for. Nobody gets a developer's
 * dashboard or app until an admin approves the share here.
 */
export function ShareRequestsPage() {
  const queryClient = useQueryClient();
  const {
    data: requests = [],
    isLoading,
    error,
  } = useQuery({ queryKey: SHARE_REQUESTS_QUERY_KEY, queryFn: getShareRequests });

  const { mutate: decide, isPending } = useMutation({
    mutationFn: ({ uuid, decision }: { uuid: string; decision: Decision }) =>
      decideShareRequest(uuid, decision),
    onSuccess: (_data, { decision }) =>
      toast.success(decision === "approve" ? "Share approved" : "Share declined"),
    onError: (e) =>
      toast.error("The share request could not be decided", {
        description: errorMessage(e, "Please try again"),
      }),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: SHARE_REQUESTS_QUERY_KEY }),
  });

  const columns = useMemo<DataTableColumn<ShareRequest>[]>(
    () => [
      {
        id: "requester",
        header: "Requested by",
        width: "22%",
        minWidth: 160,
        truncate: false,
        cell: (request) => <Person user={request.requester} />,
      },
      {
        id: "item",
        header: "Item",
        width: "24%",
        minWidth: 160,
        cell: (request) => (
          <span>
            <span className="text-ds-text-caption">
              {request.item_type === "dashboard" ? "Dashboard" : "App"}:{" "}
            </span>
            <span className="body-xs-medium">{request.item_name || "Untitled"}</span>
          </span>
        ),
      },
      {
        id: "recipient",
        header: "Shared with",
        width: "22%",
        minWidth: 160,
        truncate: false,
        cell: (request) =>
          request.recipient ? (
            <Person user={request.recipient} />
          ) : (
            <span className="body-xs-medium">Everyone in the organization</span>
          ),
      },
      {
        id: "created_date",
        header: "Requested on",
        width: "12%",
        minWidth: 110,
        cell: (request) =>
          request.created_date
            ? new Date(request.created_date).toLocaleDateString()
            : "-",
      },
      {
        id: "decision",
        header: "",
        width: "20%",
        minWidth: 170,
        truncate: false,
        cell: (request) => (
          <span className="flex gap-2 justify-end">
            <Button
              variant="outlined"
              size="xs"
              disabled={isPending}
              onClick={() => decide({ uuid: request.uuid, decision: "decline" })}
            >
              Decline
            </Button>
            <Button
              variant="primary"
              size="xs"
              disabled={isPending}
              onClick={() => decide({ uuid: request.uuid, decision: "approve" })}
            >
              Approve
            </Button>
          </span>
        ),
      },
    ],
    [decide, isPending],
  );

  return (
    <TabsPrimitive.Content
      value="share-requests"
      className="p-6 text-sm only-sm:h-screen"
    >
      {/* The requests show when they are there: no loading animation in between */}
      {isLoading ? null : error ? (
        <p className="text-xs">Error loading share requests.</p>
      ) : requests.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center min-h-[248px] bg-general-bg-primary rounded">
          <p className="text-ds-text-heading mb-2 body-sm-bold">No share requests</p>
          <p className="body-xs-regular text-ds-text-caption">
            When a developer shares a dashboard or an app, the share waits here
            <br />
            until an admin approves it.
          </p>
        </div>
      ) : (
        <DataTable columns={columns} data={requests} getRowId={getRequestId} />
      )}
    </TabsPrimitive.Content>
  );
}

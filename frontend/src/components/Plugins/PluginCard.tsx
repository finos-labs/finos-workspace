/**
 * Card for one plugin on the Admin Portal Plugins page: name, description, the approved
 * (running) version, category, what the plugin asks for, registry status and its global
 * state (Enabled, Disabled, Update available, Blocked), with "Enable"/"Disable",
 * "Review" and "Open" actions. Enabling approves the newest released version; a newer
 * release or a changed one is reviewed in a panel before it is approved.
 * Presentational only.
 */
import { useState } from "react";
import { Button } from "~/components/ds/atoms/Button";
import { Tag } from "~/components/ds/atoms/Tag";
import {
  describeRequests,
  type PluginMetadata,
  type PluginReleaseState,
  type PluginRequests,
} from "~/lib/plugins";
import { PluginReleaseReview, type ReviewReason } from "./PluginReleaseReview";

const STATUS_TAG = {
  active: null,
  inactive: { color: "grey", label: "Inactive" },
  deprecated: { color: "warning", label: "Deprecated" },
} as const;

interface PluginCardProps {
  plugin: PluginMetadata;
  /** Where the plugin stands against its releases and approval. */
  state: PluginReleaseState;
  /** The approval is being changed. */
  updating?: boolean;
  onOpen: (plugin: PluginMetadata) => void;
  /** Approve (enable) `version` of the plugin for all users and dashboards. */
  onApprove: (plugin: PluginMetadata, version: string) => void;
  onDisable: (plugin: PluginMetadata) => void;
}

/** The release an administrator can review from this state, and why. */
function reviewable(state: PluginReleaseState) {
  if (state.kind === "update-available") {
    return { reason: "update" as ReviewReason, candidate: state.latest };
  }
  if (state.kind === "changed") {
    return { reason: "changed" as ReviewReason, candidate: state.current };
  }
  if (state.kind === "missing" && state.latest) {
    return { reason: "missing" as ReviewReason, candidate: state.latest };
  }
  return null;
}

function RequestsList({
  name,
  requests,
}: {
  name: string;
  requests?: PluginRequests | null;
}) {
  if (!requests) {
    return <span className="text-ds-text-caption">Not declared by the plugin</span>;
  }
  const items = describeRequests(requests);
  if (items.length === 0) return <>Nothing beyond showing its page</>;
  return (
    <ul aria-label={`${name} asks for`}>
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

export function PluginCard({
  plugin,
  state,
  updating = false,
  onOpen,
  onApprove,
  onDisable,
}: PluginCardProps) {
  // Which release is open for review; a new or changed release starts closed.
  const [reviewingKey, setReviewingKey] = useState<string | null>(null);
  const status = STATUS_TAG[plugin.status];
  const active = plugin.status === "active";
  const approved = "approval" in state ? state.approval : undefined;
  const blocked = state.kind === "changed" || state.kind === "missing";
  const runnable = state.kind === "approved" || state.kind === "update-available";
  const review = reviewable(state);
  const reviewKey = review
    ? `${review.reason}:${review.candidate.version}:${review.candidate.digest}`
    : null;
  const reviewing = reviewKey !== null && reviewingKey === reviewKey;

  // What the admin decides on: the approved version's requests, or those of the
  // version Enable would approve.
  const shownRequests = approved
    ? approved.requests
    : state.kind === "not-approved"
      ? state.latest.requests
      : plugin.requests;

  let version: string;
  if (approved) version = approved.version;
  else if (state.kind === "not-approved") version = state.latest.version;
  else version = "Not released";

  return (
    <article
      aria-label={plugin.name}
      className="bg-general-bg-primary border border-general-border-secondary hover:border-general-border-primary rounded p-3 flex flex-col gap-3 transition-colors"
    >
      <div className="flex items-start justify-between gap-2">
        <h2 className="body-sm-medium text-ds-text-heading">{plugin.name}</h2>
        <div className="flex flex-wrap justify-end gap-1">
          {status && <Tag color={status.color}>{status.label}</Tag>}
          {blocked ? (
            <Tag color="danger">Blocked</Tag>
          ) : (
            <Tag color={approved ? "success" : "grey"}>
              {approved ? "Enabled" : "Disabled"}
            </Tag>
          )}
          {state.kind === "update-available" && (
            <Tag color="brand">Update available</Tag>
          )}
        </div>
      </div>
      <p className="text-xs text-ds-text-body line-clamp-3 flex-1">
        {plugin.description}
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-2xs text-ds-text-caption">
        <dt>Version</dt>
        <dd className="text-ds-text-body">
          {version}
          {state.kind === "update-available" && ` (${state.latest.version} available)`}
        </dd>
        <dt>Category</dt>
        <dd className="text-ds-text-body">{plugin.category}</dd>
        <dt>Asks for</dt>
        <dd className="text-ds-text-body">
          <RequestsList name={plugin.name} requests={shownRequests} />
        </dd>
      </dl>
      {state.kind === "no-release" && (
        <p className="text-2xs text-ds-text-caption">
          No released version on the plugin host yet.
        </p>
      )}
      {blocked && !reviewing && (
        <p className="text-2xs text-ds-text-body">
          {state.kind === "changed"
            ? `${approved?.version} changed on the plugin host after it was approved. It is blocked for everyone until it is reviewed.`
            : `The approved version (${approved?.version}) is no longer on the plugin host. It is blocked for everyone.`}
        </p>
      )}
      {reviewing && review && approved && (
        <PluginReleaseReview
          pluginName={plugin.name}
          approval={approved}
          candidate={review.candidate}
          reason={review.reason}
          approving={updating}
          onApprove={() => onApprove(plugin, review.candidate.version)}
          onClose={() => setReviewingKey(null)}
        />
      )}
      <div className="flex justify-end gap-2">
        {review && !reviewing && (
          <Button
            variant="outlined"
            size="xs"
            onClick={() => setReviewingKey(reviewKey)}
          >
            {review.reason === "update" ? "Review update" : "Review"}
          </Button>
        )}
        {approved ? (
          <Button
            variant="outlined"
            size="xs"
            loading={updating && !reviewing}
            disabled={updating}
            onClick={() => onDisable(plugin)}
          >
            Disable
          </Button>
        ) : (
          // Enabling approves the newest released version, pinned to its digest.
          <Button
            variant="outlined"
            size="xs"
            loading={updating}
            disabled={updating || !active || state.kind !== "not-approved"}
            onClick={() =>
              state.kind === "not-approved" && onApprove(plugin, state.latest.version)
            }
          >
            Enable
          </Button>
        )}
        <Button
          variant="secondary"
          size="xs"
          disabled={!active || !runnable}
          onClick={() => onOpen(plugin)}
        >
          Open Plugin
        </Button>
      </div>
    </article>
  );
}

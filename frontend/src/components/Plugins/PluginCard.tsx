/**
 * Card for one plugin on the Admin Portal Plugins page: name, description, the approved
 * (running) version, category, what the plugin asks for and its registry status, in one
 * of two modes:
 * - "install" (super administrator, the catalog): whether it is installed (Installed,
 *   Not installed, Update available, Blocked), with "Install"/"Uninstall", "Review" and
 *   "Preview". Installing approves the newest released version; a newer release or a
 *   changed one is reviewed in a panel before it is approved.
 * - "enable" (entity administrator, installed plugins only): whether it is enabled for
 *   the organization, with "Enable"/"Disable" and "Preview".
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

interface CardBaseProps {
  plugin: PluginMetadata;
  /** Where the plugin stands against its releases and approval (installation). */
  state: PluginReleaseState;
  /** The installation or enablement is being changed. */
  updating?: boolean;
  onPreview: (plugin: PluginMetadata) => void;
}

interface InstallCardProps extends CardBaseProps {
  mode: "install";
  /** Install `version` of the plugin, or approve it as an update or after a review. */
  onApprove: (plugin: PluginMetadata, version: string) => void;
  onUninstall: (plugin: PluginMetadata) => void;
}

interface EnableCardProps extends CardBaseProps {
  mode: "enable";
  /** The plugin is enabled for the administrator's organization. */
  enabled: boolean;
  onEnable: (plugin: PluginMetadata) => void;
  onDisable: (plugin: PluginMetadata) => void;
}

type PluginCardProps = InstallCardProps | EnableCardProps;

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

export function PluginCard(props: PluginCardProps) {
  const { plugin, state, updating = false, onPreview } = props;
  // Which release is open for review; a new or changed release starts closed.
  const [reviewingKey, setReviewingKey] = useState<string | null>(null);
  const installing = props.mode === "install";
  const status = STATUS_TAG[plugin.status];
  const active = plugin.status === "active";
  const approved = "approval" in state ? state.approval : undefined;
  const blocked = state.kind === "changed" || state.kind === "missing";
  const runnable = state.kind === "approved" || state.kind === "update-available";
  // Only a super administrator reviews releases.
  const review = installing ? reviewable(state) : null;
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
          ) : installing ? (
            <Tag color={approved ? "success" : "grey"}>
              {approved ? "Installed" : "Not installed"}
            </Tag>
          ) : (
            <Tag color={props.enabled ? "success" : "grey"}>
              {props.enabled ? "Enabled" : "Disabled"}
            </Tag>
          )}
          {installing && state.kind === "update-available" && (
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
          {installing &&
            state.kind === "update-available" &&
            ` (${state.latest.version} available)`}
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
            ? `${approved?.version} changed on the plugin host after it was approved. It is blocked for everyone until ${installing ? "it is reviewed" : "a super administrator reviews it"}.`
            : `The approved version (${approved?.version}) is no longer on the plugin host. It is blocked for everyone${installing ? "" : " until a super administrator reviews it"}.`}
        </p>
      )}
      {reviewing && review && approved && (
        <PluginReleaseReview
          pluginName={plugin.name}
          approval={approved}
          candidate={review.candidate}
          reason={review.reason}
          approving={updating}
          onApprove={() =>
            props.mode === "install" &&
            props.onApprove(plugin, review.candidate.version)
          }
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
        {props.mode === "install" &&
          (approved ? (
            <Button
              variant="danger"
              size="xs"
              loading={updating && !reviewing}
              disabled={updating}
              onClick={() => props.onUninstall(plugin)}
            >
              Uninstall
            </Button>
          ) : (
            // Installing approves the newest released version, pinned to its digest.
            <Button
              variant="primary"
              size="xs"
              loading={updating}
              disabled={updating || !active || state.kind !== "not-approved"}
              onClick={() =>
                state.kind === "not-approved" &&
                props.onApprove(plugin, state.latest.version)
              }
            >
              Install
            </Button>
          ))}
        {props.mode === "enable" &&
          (props.enabled ? (
            <Button
              variant="outlined"
              size="xs"
              loading={updating}
              disabled={updating}
              onClick={() => props.onDisable(plugin)}
            >
              Disable
            </Button>
          ) : (
            <Button
              variant="primary"
              size="xs"
              loading={updating}
              disabled={updating || !active || !runnable}
              onClick={() => props.onEnable(plugin)}
            >
              Enable
            </Button>
          ))}
        <Button
          variant="secondary"
          size="xs"
          disabled={!active || !runnable}
          onClick={() => onPreview(plugin)}
        >
          Preview
        </Button>
      </div>
    </article>
  );
}

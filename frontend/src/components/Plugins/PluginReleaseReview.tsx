/**
 * Review panel inside a plugin card: what differs between the approved version and the
 * release waiting for approval (what the plugin asks for, which files changed, release
 * notes, source commit), with "Approve" and "Not now". It shows facts for the
 * administrator to judge and never calls a plugin safe. Presentational only.
 */
import { Button } from "~/components/ds/atoms/Button";
import { diffReleases, type PluginApproval, type PluginRelease } from "~/lib/plugins";

export type ReviewReason = "update" | "changed" | "missing";

interface PluginReleaseReviewProps {
  pluginName: string;
  approval: PluginApproval;
  candidate: PluginRelease;
  reason: ReviewReason;
  approving: boolean;
  onApprove: () => void;
  onClose: () => void;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const HEADINGS: Record<ReviewReason, (from: string, to: string) => string> = {
  update: (from, to) => `Review ${to} (running ${from})`,
  changed: (from) => `${from} changed on the plugin host after it was approved`,
  missing: (from, to) =>
    `Approved ${from} is no longer on the plugin host. Review ${to}`,
};

export function PluginReleaseReview({
  pluginName,
  approval,
  candidate,
  reason,
  approving,
  onApprove,
  onClose,
}: PluginReleaseReviewProps) {
  const diff = diffReleases(approval, candidate);
  const { added, removed, changed } = diff.files;
  const noFileChanges = added.length + removed.length + changed.length === 0;
  const noRequestChanges =
    diff.requests.added.length + diff.requests.removed.length === 0 &&
    diff.requests.declaredBefore === diff.requests.declaredNow;

  return (
    <section
      aria-label={`Review ${pluginName} ${candidate.version}`}
      className="flex flex-col gap-2 rounded border border-general-border-secondary bg-general-bg-secondary p-2 text-2xs"
    >
      <h3 className="body-xs-medium text-ds-text-heading">
        {HEADINGS[reason](approval.version, candidate.version)}
      </h3>
      {reason === "changed" && (
        <p className="text-ds-text-body">
          It is blocked for everyone until it is approved again.
        </p>
      )}

      <div>
        <h4 className="text-ds-text-caption">Asks for</h4>
        {noRequestChanges ? (
          <p className="text-ds-text-body">No change</p>
        ) : (
          <ul aria-label="Request changes" className="text-ds-text-body">
            {!diff.requests.declaredNow && <li>No longer declares what it asks for</li>}
            {diff.requests.added.map((item) => (
              <li key={`+${item}`} className="text-ds-text-heading">
                + {item}
              </li>
            ))}
            {diff.requests.removed.map((item) => (
              <li key={`-${item}`}>− {item}</li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h4 className="text-ds-text-caption">Files</h4>
        {noFileChanges ? (
          <p className="text-ds-text-body">No change</p>
        ) : (
          <ul aria-label="File changes" className="text-ds-text-body break-all">
            {added.map((file) => (
              <li key={`+${file.path}`}>
                + {file.path} ({formatBytes(file.bytes)})
              </li>
            ))}
            {removed.map((file) => (
              <li key={`-${file.path}`}>− {file.path}</li>
            ))}
            {changed.map((file) => (
              <li key={`~${file.path}`}>
                ~ {file.path} ({formatBytes(file.fromBytes)} →{" "}
                {formatBytes(file.toBytes)})
              </li>
            ))}
          </ul>
        )}
      </div>

      {candidate.releaseNotes && (
        <div>
          <h4 className="text-ds-text-caption">Release notes</h4>
          <p className="text-ds-text-body">{candidate.releaseNotes}</p>
        </div>
      )}
      {candidate.source && (
        <p className="text-ds-text-caption">
          Source commit{" "}
          <span className="text-ds-text-body">
            {candidate.source.commit.slice(0, 12)}
          </span>
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="outlined" size="xs" onClick={onClose} disabled={approving}>
          Not now
        </Button>
        <Button
          variant="secondary"
          size="xs"
          loading={approving}
          disabled={approving}
          onClick={onApprove}
        >
          Approve {candidate.version}
        </Button>
      </div>
    </section>
  );
}

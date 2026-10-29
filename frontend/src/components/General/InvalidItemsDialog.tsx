import { toast } from "sonner";
import { useInvalidItemsStore } from "~/lib/state/invalidItems";
import { formatInvalidItemsAsText, type InvalidItem } from "~/lib/utils/invalidItems";
import { formatZodErrorMessage } from "~/utils/zodErrors";
import { Button } from "../ds/atoms/Button";
import { Tag } from "../ds/atoms/Tag";
import { BaseDialog } from "../ds/dialogs/BaseDialog";
import { DialogDescription, DialogFooter, DialogTitle } from "../ds/dialogs/Dialog";

const FILE_LABELS: Record<InvalidItem["file"], string> = {
  "widgets.json": "Widgets",
  "apps.json": "Apps",
  "templates.json": "Apps",
};

function ItemCard({ item }: { item: InvalidItem }) {
  return (
    <div
      className="flex flex-col gap-2 rounded border border-general-border-primary p-3"
      data-testid="invalid-item"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="body-xs-bold break-all">{item.name || item.id}</span>
        {item.name && item.name !== item.id && (
          <code className="text-2xs text-ds-text-caption break-all">{item.id}</code>
        )}
        <Tag color="grey" className="shrink-0">
          {item.file}
        </Tag>
      </div>
      <div className="flex flex-col">{formatZodErrorMessage(item.errors)}</div>
      <details className="text-xs">
        <summary className="cursor-pointer text-ds-text-caption">
          As the backend sent it
        </summary>
        <pre className="mt-1 max-h-60 overflow-auto rounded bg-general-bg-secondary p-2 text-2xs whitespace-pre-wrap break-all">
          {item.json}
        </pre>
      </details>
    </div>
  );
}

export default function InvalidItemsDialog() {
  const { sourceName, items, close } = useInvalidItemsStore((s) => ({
    sourceName: s.sourceName,
    items: s.items,
    close: s.close,
  }));

  const groups = (["widgets.json", "apps.json", "templates.json"] as const)
    .map((file) => ({ file, items: items.filter((item) => item.file === file) }))
    .filter((group) => group.items.length > 0);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(
        formatInvalidItemsAsText(sourceName ?? "", items),
      );
      toast.success("Copied the details");
    } catch {
      toast.error("Could not copy the details");
    }
  };

  return (
    <BaseDialog
      open={sourceName !== null}
      onClose={close}
      className="max-w-md lg:max-w-3xl max-h-[760px] overflow-y-auto"
    >
      <DialogTitle>Invalid items in {sourceName}</DialogTitle>
      <DialogDescription>
        These were left out. The rest of the backend is loaded. Fix them in the
        backend's widgets.json and apps.json, then refresh the backend.
      </DialogDescription>

      <div className="flex flex-col gap-4">
        {groups.map((group) => (
          <section key={group.file} className="flex flex-col gap-2">
            <h3 className="body-sm-bold">
              {FILE_LABELS[group.file]} ({group.items.length})
            </h3>
            {group.items.map((item, index) => (
              <ItemCard key={`${item.file}-${item.id}-${index}`} item={item} />
            ))}
          </section>
        ))}
      </div>

      <DialogFooter>
        <Button variant="secondary" size="sm" onClick={copy}>
          Copy details
        </Button>
        <Button variant="primary" size="sm" onClick={close}>
          Close
        </Button>
      </DialogFooter>
    </BaseDialog>
  );
}

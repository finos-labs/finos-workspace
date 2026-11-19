import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { deleteEntity } from "~/api/entities.api";
import { errorMessage } from "~/api/errors";
import { Button } from "~/components/ds/atoms/Button";
import { Switch } from "~/components/ds/atoms/Switch";
import { ConfirmDialog } from "~/components/ds/dialogs/ConfirmDialog";
import type { DataTableColumn } from "~/components/ds/molecules/DataTable";
import {
  entityAdminKeys,
  useEntities,
  useRemovedEntities,
} from "~/hooks/useEntityAdmin";
import type { Entity } from "~/types/entity.type";
import { AdminEntityTable } from "./AdminEntityTable";
import { EntityCreateDialog } from "./EntityCreateDialog";
import { EntityEditDialog } from "./EntityEditDialog";
import { EntityRestoreDialog } from "./EntityRestoreDialog";

const COLUMNS: DataTableColumn<Entity>[] = [
  {
    id: "name",
    header: "Name",
    width: "55%",
    minWidth: 160,
    sortable: true,
    cell: (entity) => entity.name,
  },
  {
    id: "sharing",
    header: "Sharing",
    width: "20%",
    minWidth: 90,
    sortable: true,
    cell: (entity) => (entity.sharing_enabled ? "Enabled" : "Disabled"),
  },
  {
    id: "status",
    header: "Status",
    width: "25%",
    minWidth: 90,
    sortable: true,
    cell: (entity) => (entity.disabled ? "Disabled" : "Active"),
  },
];

const SORT_VALUES: Record<string, (entity: Entity) => string | number> = {
  name: (entity) => entity.name.toLowerCase(),
  sharing: (entity) => (entity.sharing_enabled ? 1 : 0),
  status: (entity) => (entity.disabled ? 1 : 0),
};

const searchText = (entity: Entity) => entity.name;

const getEntityId = (entity: Entity) => entity.uuid;

export function EntitiesTab() {
  const [showRemoved, setShowRemoved] = useState(false);
  const activeQuery = useEntities();
  const removedQuery = useRemovedEntities(showRemoved);
  const entitiesQuery = showRemoved ? removedQuery : activeQuery;
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Entity | "new" | null>(null);
  const [removing, setRemoving] = useState<Entity | null>(null);
  const [restoring, setRestoring] = useState<Entity | null>(null);

  async function confirmRemove() {
    if (!removing) return;
    const entity = removing;
    setRemoving(null);
    try {
      await deleteEntity(entity.uuid);
    } catch (e) {
      toast.error(errorMessage(e, "Unable to remove the entity"));
      return;
    }
    toast.success("Entity removed");
    await queryClient.invalidateQueries({ queryKey: entityAdminKeys.root });
  }

  return (
    <>
      <AdminEntityTable
        rows={entitiesQuery.data ?? []}
        columns={COLUMNS}
        getRowId={getEntityId}
        sortValues={SORT_VALUES}
        searchText={searchText}
        searchPlaceholder="Search for entities"
        addLabel="Add entity"
        editLabel="Edit entity"
        onAdd={showRemoved ? undefined : () => setEditing("new")}
        onEdit={showRemoved ? undefined : setEditing}
        deleteLabel="Remove entity"
        onDelete={showRemoved ? undefined : setRemoving}
        restoreLabel="Restore entity"
        onRestore={showRemoved ? setRestoring : undefined}
        toolbar={
          <Switch
            label="Show removed"
            checked={showRemoved}
            onCheckedChange={setShowRemoved}
          />
        }
        isLoading={entitiesQuery.isLoading}
        isError={entitiesQuery.isError}
        emptyMessage={showRemoved ? "No removed entities" : "No entities yet"}
      />
      {editing === "new" && <EntityCreateDialog onClose={() => setEditing(null)} />}
      {editing && editing !== "new" && (
        <EntityEditDialog entity={editing} onClose={() => setEditing(null)} />
      )}
      {restoring && (
        <EntityRestoreDialog entity={restoring} onClose={() => setRestoring(null)} />
      )}
      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        title="Remove entity"
        description={`Remove ${removing?.name ?? "this entity"}? It leaves this list and its name can be used again. An entity that still has users cannot be removed.`}
        confirmButton={
          <Button variant="danger" size="sm" onClick={confirmRemove}>
            Yes, Remove
          </Button>
        }
      />
    </>
  );
}

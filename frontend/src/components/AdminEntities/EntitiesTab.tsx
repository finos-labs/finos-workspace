import { useState } from "react";
import type { DataTableColumn } from "~/components/ds/molecules/DataTable";
import { useEntities } from "~/hooks/useEntityAdmin";
import type { Entity } from "~/types/entity.type";
import { AdminEntityTable } from "./AdminEntityTable";
import { EntityCreateDialog } from "./EntityCreateDialog";
import { EntityEditDialog } from "./EntityEditDialog";

const COLUMNS: DataTableColumn<Entity>[] = [
  {
    id: "name",
    header: "Name",
    width: "70%",
    minWidth: 160,
    sortable: true,
    cell: (entity) => entity.name,
  },
  {
    id: "sharing",
    header: "Sharing",
    width: "30%",
    minWidth: 90,
    sortable: true,
    cell: (entity) => (entity.sharing_enabled ? "Enabled" : "Disabled"),
  },
];

const SORT_VALUES: Record<string, (entity: Entity) => string | number> = {
  name: (entity) => entity.name.toLowerCase(),
  sharing: (entity) => (entity.sharing_enabled ? 1 : 0),
};

const searchText = (entity: Entity) => entity.name;

const getEntityId = (entity: Entity) => entity.uuid;

export function EntitiesTab() {
  const entitiesQuery = useEntities();
  const [editing, setEditing] = useState<Entity | "new" | null>(null);

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
        onAdd={() => setEditing("new")}
        onEdit={setEditing}
        isLoading={entitiesQuery.isLoading}
        isError={entitiesQuery.isError}
        emptyMessage="No entities yet"
      />
      {editing === "new" && <EntityCreateDialog onClose={() => setEditing(null)} />}
      {editing && editing !== "new" && (
        <EntityEditDialog entity={editing} onClose={() => setEditing(null)} />
      )}
    </>
  );
}

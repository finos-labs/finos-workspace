import { useMemo, useState } from "react";
import type { DataTableColumn } from "~/components/ds/molecules/DataTable";
import { useEntities, useEntityMaps } from "~/hooks/useEntityAdmin";
import type { EntityMapItem } from "~/types/entity.type";
import { AdminEntityTable } from "./AdminEntityTable";
import { EntityMapDialog } from "./EntityMapDialog";

const COLUMNS: DataTableColumn<EntityMapItem>[] = [
  {
    id: "entity",
    header: "Entity",
    width: "50%",
    minWidth: 180,
    sortable: true,
    cell: (map) => map.entity.name,
  },
  {
    id: "name",
    header: "Permission map",
    width: "50%",
    minWidth: 180,
    sortable: true,
    cell: (map) => map.name,
  },
];

const SORT_VALUES: Record<string, (map: EntityMapItem) => string> = {
  entity: (map) => map.entity.name.toLowerCase(),
  name: (map) => map.name.toLowerCase(),
};

const searchText = (map: EntityMapItem) => `${map.entity.name} ${map.name}`;
const getMapId = (map: EntityMapItem) => map.uuid;

export function EntityMapsTab() {
  const mapsQuery = useEntityMaps();
  const entitiesQuery = useEntities();
  const [editing, setEditing] = useState<EntityMapItem | "new" | null>(null);
  const entities = useMemo(() => entitiesQuery.data ?? [], [entitiesQuery.data]);

  return (
    <>
      <AdminEntityTable
        rows={mapsQuery.data ?? []}
        columns={COLUMNS}
        getRowId={getMapId}
        sortValues={SORT_VALUES}
        searchText={searchText}
        searchPlaceholder="Search for permission maps"
        addLabel="Add permission map"
        editLabel="Edit permission map"
        onAdd={() => setEditing("new")}
        onEdit={setEditing}
        isLoading={mapsQuery.isLoading}
        isError={mapsQuery.isError}
        emptyMessage="No permission maps yet"
      />
      {editing && (
        <EntityMapDialog
          map={editing === "new" ? undefined : editing}
          entities={entities}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

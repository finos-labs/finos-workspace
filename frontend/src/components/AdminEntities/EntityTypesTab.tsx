import { useState } from "react";
import type { DataTableColumn } from "~/components/ds/molecules/DataTable";
import { useEntityTypes } from "~/hooks/useEntityAdmin";
import type { EntityType } from "~/types/entity.type";
import { AdminEntityTable } from "./AdminEntityTable";
import { EntityTypeDialog } from "./EntityTypeDialog";

const COLUMNS: DataTableColumn<EntityType>[] = [
  {
    id: "name",
    header: "Entity type",
    width: "35%",
    minWidth: 160,
    sortable: true,
    cell: (type) => type.entity_type,
  },
  {
    id: "code",
    header: "Code",
    width: "15%",
    minWidth: 80,
    sortable: true,
    cell: (type) => type.code,
  },
  {
    id: "active",
    header: "Active",
    width: "15%",
    minWidth: 80,
    sortable: true,
    cell: (type) => (type.active ? "Yes" : "No"),
  },
  {
    id: "hierarchy",
    header: "Permission hierarchy",
    width: "25%",
    minWidth: 150,
    sortable: true,
    cell: (type) => type.permission_hierarchy,
  },
];

const SORT_VALUES: Record<string, (type: EntityType) => string | number> = {
  name: (type) => type.entity_type.toLowerCase(),
  code: (type) => type.code.toLowerCase(),
  active: (type) => (type.active ? 1 : 0),
  hierarchy: (type) => type.permission_hierarchy,
};

const searchText = (type: EntityType) => `${type.entity_type} ${type.code}`;
const getTypeId = (type: EntityType) => type.uuid;

export function EntityTypesTab() {
  const typesQuery = useEntityTypes();
  const [editing, setEditing] = useState<EntityType | "new" | null>(null);

  return (
    <>
      <AdminEntityTable
        rows={typesQuery.data ?? []}
        columns={COLUMNS}
        getRowId={getTypeId}
        sortValues={SORT_VALUES}
        searchText={searchText}
        searchPlaceholder="Search for entity types"
        addLabel="Add entity type"
        editLabel="Edit entity type"
        onAdd={() => setEditing("new")}
        onEdit={setEditing}
        isLoading={typesQuery.isLoading}
        isError={typesQuery.isError}
        emptyMessage="No entity types yet"
      />
      {editing && (
        <EntityTypeDialog
          entityType={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

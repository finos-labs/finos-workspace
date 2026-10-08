import { useMemo, useState } from "react";
import type { EntityRelationship } from "~/api/entities.api";
import type { DataTableColumn } from "~/components/ds/molecules/DataTable";
import { useEntities, useEntityRelationships } from "~/hooks/useEntityAdmin";
import { AdminEntityTable } from "./AdminEntityTable";
import { EntityRelationshipDialog } from "./EntityRelationshipDialog";

const COLUMNS: DataTableColumn<EntityRelationship>[] = [
  {
    id: "parent",
    header: "Parent",
    width: "34%",
    minWidth: 160,
    sortable: true,
    cell: (relationship) => relationship.parent.name,
  },
  {
    id: "child",
    header: "Child",
    width: "33%",
    minWidth: 160,
    sortable: true,
    cell: (relationship) => relationship.child.name,
  },
  {
    id: "supreme",
    header: "Top of the hierarchy",
    width: "33%",
    minWidth: 160,
    sortable: true,
    cell: (relationship) => relationship.supreme.name,
  },
];

const SORT_VALUES: Record<string, (relationship: EntityRelationship) => string> = {
  parent: (relationship) => relationship.parent.name.toLowerCase(),
  child: (relationship) => relationship.child.name.toLowerCase(),
  supreme: (relationship) => relationship.supreme.name.toLowerCase(),
};

const searchText = (relationship: EntityRelationship) =>
  `${relationship.parent.name} ${relationship.child.name} ${relationship.supreme.name}`;
const getRelationshipId = (relationship: EntityRelationship) => relationship.uuid;

export function EntityRelationshipsTab() {
  const relationshipsQuery = useEntityRelationships();
  const entitiesQuery = useEntities();
  const [editing, setEditing] = useState<EntityRelationship | "new" | null>(null);
  const entities = useMemo(() => entitiesQuery.data ?? [], [entitiesQuery.data]);

  return (
    <>
      <AdminEntityTable
        rows={relationshipsQuery.data ?? []}
        columns={COLUMNS}
        getRowId={getRelationshipId}
        sortValues={SORT_VALUES}
        searchText={searchText}
        searchPlaceholder="Search for relationships"
        addLabel="Add relationship"
        editLabel="Edit relationship"
        onAdd={() => setEditing("new")}
        onEdit={setEditing}
        isLoading={relationshipsQuery.isLoading}
        isError={relationshipsQuery.isError}
        emptyMessage="No relationships yet"
      />
      {editing && (
        <EntityRelationshipDialog
          relationship={editing === "new" ? undefined : editing}
          entities={entities}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

import dayjs from "dayjs";
import { useMemo, useState } from "react";
import type { DataTableColumn } from "~/components/ds/molecules/DataTable";
import { useEntities, useEntityTypes } from "~/hooks/useEntityAdmin";
import type { Entity } from "~/types/entity.type";
import { AdminEntityTable } from "./AdminEntityTable";
import { EntityCreateDialog } from "./EntityCreateDialog";
import { EntityEditDialog } from "./EntityEditDialog";

const COLUMNS: DataTableColumn<Entity>[] = [
  {
    id: "name",
    header: "Name",
    width: "22%",
    minWidth: 160,
    sortable: true,
    cell: (entity) => entity.name,
  },
  {
    id: "type",
    header: "Type",
    width: "14%",
    minWidth: 110,
    sortable: true,
    cell: (entity) => entity.entity_type.entity_type,
  },
  {
    id: "email",
    header: "Email",
    width: "22%",
    minWidth: 180,
    sortable: true,
    cell: (entity) => entity.email || "-",
  },
  {
    id: "country",
    header: "Country",
    width: "10%",
    minWidth: 90,
    sortable: true,
    cell: (entity) => entity.country || "-",
  },
  {
    id: "seats",
    header: "Seats",
    width: "8%",
    minWidth: 70,
    sortable: true,
    cell: (entity) => entity.seats ?? "-",
  },
  {
    id: "expires",
    header: "Expires",
    width: "14%",
    minWidth: 120,
    sortable: true,
    cell: (entity) =>
      entity.expiration_date
        ? dayjs(entity.expiration_date).format("MMM D, YYYY")
        : "-",
  },
];

const SORT_VALUES: Record<string, (entity: Entity) => string | number> = {
  name: (entity) => entity.name.toLowerCase(),
  type: (entity) => entity.entity_type.entity_type.toLowerCase(),
  email: (entity) => (entity.email ?? "").toLowerCase(),
  country: (entity) => (entity.country ?? "").toLowerCase(),
  seats: (entity) => entity.seats ?? 0,
  expires: (entity) =>
    entity.expiration_date ? Date.parse(entity.expiration_date) : 0,
};

const searchText = (entity: Entity) =>
  [entity.name, entity.entity_type.entity_type, entity.email, entity.country].join(" ");

const getEntityId = (entity: Entity) => entity.uuid;

export function EntitiesTab() {
  const entitiesQuery = useEntities();
  const typesQuery = useEntityTypes();
  const [editing, setEditing] = useState<Entity | "new" | null>(null);
  const entityTypes = useMemo(() => typesQuery.data ?? [], [typesQuery.data]);

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
      {editing === "new" && (
        <EntityCreateDialog
          entityTypes={entityTypes}
          onClose={() => setEditing(null)}
        />
      )}
      {editing && editing !== "new" && (
        <EntityEditDialog
          entity={editing}
          entityTypes={entityTypes}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

import { useMemo, useState } from "react";
import type { DataTableColumn } from "~/components/ds/molecules/DataTable";
import { useEntityMaps, useEntityUsers } from "~/hooks/useEntityAdmin";
import type { EntityUser } from "~/types/entity.type";
import { AdminEntityTable } from "./AdminEntityTable";
import { UserMoveDialog } from "./UserMoveDialog";

const NONE = "None";

const COLUMNS: DataTableColumn<EntityUser>[] = [
  {
    id: "email",
    header: "Email",
    width: "40%",
    minWidth: 220,
    sortable: true,
    cell: (user) => user.email,
  },
  {
    id: "entity",
    header: "Entity",
    width: "35%",
    minWidth: 180,
    sortable: true,
    cell: (user) => user.permissions?.entity.name ?? NONE,
  },
  {
    id: "type",
    header: "User type",
    width: "25%",
    minWidth: 120,
    sortable: true,
    cell: (user) => user.permissions?.name ?? NONE,
  },
];

const SORT_VALUES: Record<string, (user: EntityUser) => string> = {
  email: (user) => user.email.toLowerCase(),
  entity: (user) => (user.permissions?.entity.name ?? "").toLowerCase(),
  type: (user) => user.permissions?.name ?? "",
};

const searchText = (user: EntityUser) =>
  `${user.email} ${user.permissions?.entity.name ?? ""} ${user.permissions?.name ?? ""}`;
const getUserId = (user: EntityUser) => user.uuid;

export function UsersTab() {
  const usersQuery = useEntityUsers();
  const mapsQuery = useEntityMaps();
  const [moving, setMoving] = useState<EntityUser | null>(null);
  const maps = useMemo(() => mapsQuery.data ?? [], [mapsQuery.data]);

  return (
    <>
      <AdminEntityTable
        rows={usersQuery.data ?? []}
        columns={COLUMNS}
        getRowId={getUserId}
        sortValues={SORT_VALUES}
        searchText={searchText}
        searchPlaceholder="Search for users"
        editLabel="Move user"
        onEdit={setMoving}
        isLoading={usersQuery.isLoading}
        isError={usersQuery.isError}
        emptyMessage="No users yet"
      />
      {moving && (
        <UserMoveDialog user={moving} maps={maps} onClose={() => setMoving(null)} />
      )}
    </>
  );
}

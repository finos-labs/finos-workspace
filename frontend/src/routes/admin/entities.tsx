import * as TabsPrimitive from "@radix-ui/react-tabs";
import { Navigate } from "react-router-dom";
import { EntitiesTab } from "~/components/AdminEntities/EntitiesTab";
import { EntityMapsTab } from "~/components/AdminEntities/EntityMapsTab";
import { UsersTab } from "~/components/AdminEntities/UsersTab";
import { SettingsLayout } from "~/components/LayoutAuth/Skeleton/SettingsLayout";
import { useIsEntityAdmin } from "~/hooks/useEntityAdmin";

const TABS = [
  { label: "Entities", id: "entities", disabled: false },
  { label: "Permission maps", id: "permission-maps", disabled: false },
  { label: "All users", id: "users", disabled: false },
];

export default function AdminEntities() {
  const { isEntityAdmin, isLoading } = useIsEntityAdmin();

  if (isLoading) return null;

  if (!isEntityAdmin) return <Navigate to="/admin" />;

  return (
    <SettingsLayout
      title="Entity Management"
      description="Organizations, whether they may share, their permission maps and their users."
      tabs={TABS}
      defaultTab="entities"
    >
      <TabsPrimitive.Content value="entities" className="outline-none">
        <EntitiesTab />
      </TabsPrimitive.Content>
      <TabsPrimitive.Content value="permission-maps" className="outline-none">
        <EntityMapsTab />
      </TabsPrimitive.Content>
      <TabsPrimitive.Content value="users" className="outline-none">
        <UsersTab />
      </TabsPrimitive.Content>
    </SettingsLayout>
  );
}

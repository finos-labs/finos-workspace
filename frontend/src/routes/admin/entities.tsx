import * as TabsPrimitive from "@radix-ui/react-tabs";
import { Navigate } from "react-router-dom";
import { EntitiesTab } from "~/components/AdminEntities/EntitiesTab";
import { EntityMapsTab } from "~/components/AdminEntities/EntityMapsTab";
import { EntityRelationshipsTab } from "~/components/AdminEntities/EntityRelationshipsTab";
import { EntityTypesTab } from "~/components/AdminEntities/EntityTypesTab";
import BrandedLoadingState from "~/components/General/BrandedLoadingState";
import { SettingsLayout } from "~/components/LayoutAuth/Skeleton/SettingsLayout";
import { useIsEntityAdmin } from "~/hooks/useEntityAdmin";

const TABS = [
  { label: "Entities", id: "entities", disabled: false },
  { label: "Entity types", id: "entity-types", disabled: false },
  { label: "Relationships", id: "relationships", disabled: false },
  { label: "Permission maps", id: "permission-maps", disabled: false },
];

export default function AdminEntities() {
  const { isEntityAdmin, isLoading } = useIsEntityAdmin();

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-surface-page">
        <BrandedLoadingState />
      </div>
    );
  }

  if (!isEntityAdmin) return <Navigate to="/admin" />;

  return (
    <SettingsLayout
      title="Entity Management"
      description="Organizations, their seats and entitlements, and how they relate."
      tabs={TABS}
      defaultTab="entities"
    >
      <TabsPrimitive.Content value="entities" className="outline-none">
        <EntitiesTab />
      </TabsPrimitive.Content>
      <TabsPrimitive.Content value="entity-types" className="outline-none">
        <EntityTypesTab />
      </TabsPrimitive.Content>
      <TabsPrimitive.Content value="relationships" className="outline-none">
        <EntityRelationshipsTab />
      </TabsPrimitive.Content>
      <TabsPrimitive.Content value="permission-maps" className="outline-none">
        <EntityMapsTab />
      </TabsPrimitive.Content>
    </SettingsLayout>
  );
}

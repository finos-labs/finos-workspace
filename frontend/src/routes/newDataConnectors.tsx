import * as TabsPrimitive from "@radix-ui/react-tabs";
import { MyWidgetsTab } from "~/components/DataConnectors/MyWidgetsTab";
import { SettingsLayout } from "~/components/LayoutAuth/Skeleton/SettingsLayout";
import { MyDataConnectorsProvider } from "~/lib/contexts/MyDataConnectorsContext";

const TABS = [{ label: "My Data", id: "my-data" }];

export default function DataConnectors() {
  return (
    <SettingsLayout title="Widgets Library" tabs={TABS} defaultTab="my-data">
      <TabsPrimitive.Content value="my-data">
        <MyDataConnectorsProvider>
          <MyWidgetsTab />
        </MyDataConnectorsProvider>
      </TabsPrimitive.Content>
    </SettingsLayout>
  );
}

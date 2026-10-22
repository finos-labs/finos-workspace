import { memo, useEffect } from "react";
import { useIsEntityAdmin } from "~/hooks/useEntityAdmin";
import { useShallowSidebarStore } from "~/lib/state/sidebar";
import Sidebar from "../General/Sidebar";
import SidebarNavButton from "../General/SidebarNavButton";
import { useLayoutPanelsState } from "../LayoutAuth/AppLayout/hooks/usePanelsState";
import HamburgerMenu from "../LayoutAuth/HamburgerMenu";

function AdminSidebar({
  expandedState,
}: {
  expandedState: { left: boolean; collapsedLeft: boolean };
}) {
  const [_, dispatch] = useLayoutPanelsState();
  const setEffectiveExpanded = useShallowSidebarStore(
    (state) => state.setEffectiveExpanded,
  );
  const { isEntityAdmin } = useIsEntityAdmin();

  useEffect(() => {
    setEffectiveExpanded(expandedState.left && !expandedState.collapsedLeft);
    dispatch((state) => ({
      ...state,
      adminleft: expandedState.left,
      admincollapsedLeft: expandedState.collapsedLeft,
    }));
  }, [expandedState, dispatch]);

  return (
    <Sidebar header={<HamburgerMenu />}>
      <div className="flex flex-col gap-2.5 mt-1.5 @max-[100px]:items-center">
        <SidebarNavButton to="/admin/users" title="Users" icon="person-icon" />
        <SidebarNavButton
          to="/admin/roles"
          title="Roles and Access"
          icon="user-group"
        />
        {isEntityAdmin && (
          <SidebarNavButton to="/admin/entities" title="Entities" icon="building-06" />
        )}
        <SidebarNavButton to="/admin/apps" title="Apps" icon="chart-icon" />
        <SidebarNavButton
          to="/admin/plugins"
          title="Plugins"
          icon="solar-widget-add-outline"
        />
        <SidebarNavButton
          to="/admin/theme-settings"
          title="Theme"
          icon="solar-palette-2-linear"
        />
        <SidebarNavButton to="/admin/account" title="Account" icon="cog" />
      </div>
    </Sidebar>
  );
}

export default memo(AdminSidebar);

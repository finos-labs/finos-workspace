import { Fragment, memo, type ReactNode, useMemo } from "react";
import { Link } from "react-router-dom";
import Icon from "~/components/Icon";
import { VERSION } from "~/lib/constants";
import { getConfig } from "~/lib/runtimeConfig";
import { useShallowAuthStore } from "~/lib/state/auth";
import { useShallowSidebarStore } from "~/lib/state/sidebar";
import { useShallowThemeStore } from "~/lib/state/theme";
import Tooltip from "../Tooltip";
import ChangelogDialog from "./ChangelogDialog";

interface Props {
  header?: ReactNode;
  search?: ReactNode;
  children: ReactNode;
}

const uiShowChangelogFF = getConfig().ui.showChangelog;
const { leftSidebarLogo, leftSidebarLogoDark, name: wlName } = getConfig().whiteLabel;

const isWhitelabel =
  (leftSidebarLogo && leftSidebarLogo !== "") || (wlName && wlName !== "Workspace");

export function Sidebar(props: Props) {
  const { header, search, children } = props;

  const theme = useShallowThemeStore((state) => state.theme);

  const sideBarHeader = useMemo(() => {
    return (
      <div
        className="@max-[100px]:flex-col
        flex w-full items-center justify-between
        @max-[100px]:gap-2 text-light-900 dark:text-white mb-2.5"
      >
        <Link
          to="/app"
          className="@max-[100px]:flex-col flex items-center justify-center gap-2"
        >
          {leftSidebarLogo ? (
            <img
              src={
                theme === "dark" && leftSidebarLogoDark
                  ? leftSidebarLogoDark
                  : leftSidebarLogo
              }
              alt={wlName || "Logo"}
              className="size-9 object-contain"
            />
          ) : (
            <Icon id="brand-mark" className="h-4 w-8 text-light-800 dark:text-white" />
          )}
        </Link>
        {header && (
          <div className="@max-[100px]:flex-col flex items-center justify-center">
            {header}
          </div>
        )}
      </div>
    );
  }, [header, theme]);

  const searchMemo = useMemo(
    () =>
      search && (
        <div className="relative flex-col text-xs" key="sidebar-search">
          {search}
        </div>
      ),
    [search],
  );
  const sideBarFooter = useMemo(() => <SidebarFooter key="sidebar-footer" />, []);
  const dialogMemo = useMemo(() => <ChangelogHost key="changelog-host" />, []);

  return (
    <Fragment key="sidebar-fragment">
      {dialogMemo}
      <div
        id="sidebar"
        data-testid="sidebar"
        className="@container relative justify-between overflow-x-auto bg-white
        transition-opacity duration-200 dark:bg-dark-900
        flex h-full flex-col items-center overflow-y-hidden p-3.5"
      >
        <div className="flex w-full flex-1 flex-col text-xs @max-[100px]:items-center overflow-hidden">
          {sideBarHeader}
          {searchMemo}
          {children}
        </div>
        <div className="mt-auto flex flex-col items-center justify-center flex-shrink-0 w-full">
          {sideBarFooter}
        </div>
      </div>
    </Fragment>
  );
}

function ChangelogHost() {
  const { showChangelog, updateShowChangelog } = useShallowAuthStore((s) => ({
    showChangelog: s.showChangelog,
    updateShowChangelog: s.updateShowChangelog,
  }));

  return useMemo(
    () => (
      <ChangelogDialog
        open={uiShowChangelogFF ? showChangelog : false}
        onClose={() => updateShowChangelog(false)}
      />
    ),
    [showChangelog],
  );
}

function SidebarFooter() {
  const expanded = useShallowSidebarStore((state) => state.effectiveExpanded);

  const updateShowChangelog = useShallowAuthStore((s) => s.updateShowChangelog);

  return (
    <div className="flex flex-col items-center gap-0.5">
      <Tooltip
        message="Click here to check changelog"
        position={expanded ? "top" : "right"}
      >
        <button
          className="body-xs-medium text-2xs text-light-600 dark:text-light-200"
          onClick={() => updateShowChangelog(true)}
        >
          {VERSION}
        </button>
      </Tooltip>
      {isWhitelabel && (
        <p className="text-center body-xs-regular text-2xs text-light-500 dark:text-light-400">
          Powered by Workspace
        </p>
      )}
    </div>
  );
}

export default memo(Sidebar);

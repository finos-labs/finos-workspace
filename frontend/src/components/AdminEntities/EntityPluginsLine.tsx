import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { getPlatformPlugins } from "~/api/plugins.api";
import { pluginKeys } from "~/hooks/usePlugins";

export function EntityPluginsLine({ entityUuid }: { entityUuid: string }) {
  const { data } = useQuery({
    queryKey: pluginKeys.platform,
    queryFn: getPlatformPlugins,
  });
  if (!data?.enabled) return null;
  const enabled = data.plugins
    .filter((plugin) =>
      plugin.enabled_for.some((use) => use.entity_uuid === entityUuid),
    )
    .map((plugin) => plugin.name);
  return (
    <p className="body-xs-regular" data-testid="entity-plugins">
      <span className="body-xs-medium">Widget plugins: </span>
      {enabled.length ? enabled.join(", ") : "none enabled"}.{" "}
      <Link to="/admin/widgets" className="ws-hyper-link">
        Manage them in Widgets
      </Link>
    </p>
  );
}

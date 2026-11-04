import { useQuery } from "@tanstack/react-query";
import { getPluginEvents, getPluginReports } from "~/api/plugins.api";
import { Button } from "~/components/ds/atoms/Button";
import { pluginKeys } from "~/hooks/usePlugins";
import { formatWhen, Section } from "./common";

export function PluginEvents(props: {
  pluginId: string;
  scope: "platform" | "entity";
}) {
  const { data = [] } = useQuery({
    queryKey: pluginKeys.events(props.pluginId, props.scope),
    queryFn: () => getPluginEvents(props.pluginId, props.scope),
  });
  return (
    <Section title="Activity">
      {data.length === 0 ? (
        <p className="body-xs-regular text-ds-text-caption">Nothing recorded yet.</p>
      ) : (
        <ul className="flex max-h-60 flex-col gap-1 overflow-y-auto">
          {data.map((event, index) => (
            <li key={`${event.created_date}-${index}`} className="body-xs-regular">
              <span className="text-ds-text-caption">
                {formatWhen(event.created_date)}
              </span>{" "}
              <span className="body-xs-medium">{event.action}</span>
              {event.version && ` ${event.version}`}
              {Object.keys(event.details).length > 0 && (
                <span className="text-ds-text-caption">
                  {" "}
                  {JSON.stringify(event.details).slice(0, 300)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export function BlockedRequests(props: {
  pluginId: string;
  scope: "platform" | "entity";
  onAllow?: (directive: string, origin: string) => void;
}) {
  const { data = [] } = useQuery({
    queryKey: pluginKeys.reports(props.pluginId, props.scope),
    queryFn: () => getPluginReports(props.pluginId, props.scope),
  });
  return (
    <Section
      title="Blocked requests"
      hint="What the frames tried to reach and their policy refused."
    >
      {data.length === 0 ? (
        <p className="body-xs-regular text-ds-text-caption">None reported.</p>
      ) : (
        <ul className="flex max-h-60 flex-col gap-1 overflow-y-auto">
          {data.map((report) => (
            <li
              key={`${report.directive}-${report.origin}-${report.entity_uuid}`}
              className="flex items-center gap-2 body-xs-regular"
            >
              <span className="font-mono">{report.directive}</span>
              <span className="break-all">{report.origin}</span>
              <span className="text-ds-text-caption">
                {report.count}× (last {formatWhen(report.last_seen)})
              </span>
              {props.onAllow && report.origin.includes("://") && (
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={() => props.onAllow?.(report.directive, report.origin)}
                >
                  Allow
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

import * as TabsPrimitive from "@radix-ui/react-tabs";
import { Checkbox } from "~/components/Forms/Checkbox";
import { getConfig } from "~/lib/runtimeConfig";
import { useShallowThemeStore } from "~/lib/state/theme";

const showMinimizeWidgetFF = getConfig().ui.showMinimizeWidget;

export default function WidgetTab() {
  const {
    showWidgetControlsEllipsis,
    showMinimizeButton,
    autoHideWidgetNavbar,
    updateDisplaySettings,
  } = useShallowThemeStore((state) => ({
    showWidgetControlsEllipsis: state.showWidgetControlsEllipsis,
    showMinimizeButton: state.showMinimizeButton,
    autoHideWidgetNavbar: state.autoHideWidgetNavbar,
    updateDisplaySettings: state.updateDisplaySettings,
  }));

  return (
    <TabsPrimitive.Content className="mt-5 mb-5 text-xs" value="widget">
      <form className="flex gap-4 flex-col">
        <div className="flex flex-col bg-general-bg-primary rounded-md p-4 gap-2.5 py-5">
          <p className="body-sm-medium">Widget control icons</p>
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <Checkbox
                checked={showWidgetControlsEllipsis}
                onChange={(showWidgetControlsEllipsis) =>
                  updateDisplaySettings({ showWidgetControlsEllipsis })
                }
                id="widget-control-icons"
              />
              <label
                htmlFor="widget-control-icons"
                className="inline-flex items-center gap-3"
              >
                Collapse widget controls: Hides action icons behind a chevron, revealed
                on hover
              </label>
            </div>
            {showMinimizeWidgetFF && (
              <div className="flex items-center gap-3">
                <Checkbox
                  checked={showMinimizeButton}
                  onChange={(showMinimizeButton) =>
                    updateDisplaySettings({ showMinimizeButton })
                  }
                  id="show-minimize-button-control"
                />
                <label
                  htmlFor="show-minimize-button-control"
                  className="inline-flex items-center gap-3"
                >
                  Minimize button on header: Adds a minimize icon to collapse the widget
                  in place
                </label>
              </div>
            )}
            <div className="flex items-center gap-3">
              <Checkbox
                checked={autoHideWidgetNavbar}
                onChange={(autoHideWidgetNavbar) =>
                  updateDisplaySettings({ autoHideWidgetNavbar })
                }
                id="auto-hide-widget-navbar"
              />
              <label
                htmlFor="auto-hide-widget-navbar"
                className="inline-flex items-center gap-3"
              >
                Auto-hide iframe widget navbar (show on hover)
              </label>
            </div>
          </div>
        </div>
      </form>
    </TabsPrimitive.Content>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { HexColorPicker } from "react-colorful";
import { Button } from "~/components/ds/atoms/Button";
import { Input } from "~/components/ds/atoms/Input";
import { Popover, PopoverTrigger } from "~/components/ds/atoms/Popover";
import { Select } from "~/components/ds/atoms/Select";
import SettingsMenu from "~/components/ds/molecules/SettingsMenu";
import { cn } from "~/components/ds/utils";
import Icon from "~/components/Icon";
import {
  useShallowThemePresetsStore,
  useThemePresetsStore,
} from "~/lib/state/themePresets";
import { DERIVED_SHADES } from "~/lib/theme/css";
import {
  baseValue,
  FONT_FAMILIES,
  THEME_GROUPS,
  THEME_PROPERTIES,
  type ThemeProperty,
  type ThemeScope,
} from "~/lib/theme/properties";
import { getContrastTextColor, toHex } from "~/utils/colorUtils";

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const BRAND_GROUP = "Brand";

function isValid(property: ThemeProperty, value: string): boolean {
  if (property.kind !== "color") return value.trim().length > 0;
  return typeof CSS === "undefined" || CSS.supports("color", value.trim());
}

function Swatch({ value, onPick }: { value: string; onPick: (hex: string) => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [hex, setHex] = useState("#000000");

  function handleOpenChange(next: boolean) {
    if (next && ref.current) {
      const resolved = toHex(getComputedStyle(ref.current).backgroundColor);
      setHex(HEX_COLOR.test(resolved) ? resolved : "#000000");
    }
    setOpen(next);
  }

  return (
    <Popover
      open={open}
      onOpenChange={handleOpenChange}
      side="bottom"
      align="start"
      sideOffset={4}
      className="w-full text-sm p-2 min-w-[200px]"
      content={
        <HexColorPicker
          color={hex}
          onChange={(next) => {
            setHex(next);
            onPick(next);
          }}
          className="!w-full"
        />
      }
    >
      <PopoverTrigger asChild={true}>
        <button
          type="button"
          aria-label="Pick a color"
          className="flex items-center justify-center size-5 rounded-sm border border-general-border-primary bg-[repeating-conic-gradient(#8884_0_25%,transparent_0_50%)] bg-[length:8px_8px]"
        >
          <span
            ref={ref}
            className="block size-full rounded-sm"
            style={{ backgroundColor: value }}
          />
        </button>
      </PopoverTrigger>
    </Popover>
  );
}

function PropertyRow({
  property,
  scope,
  value,
  edited,
  onChange,
  onClear,
}: {
  property: ThemeProperty;
  scope: ThemeScope;
  value: string;
  edited: boolean;
  onChange: (name: string, value: string) => void;
  onClear: (name: string) => void;
}) {
  const [text, setText] = useState(value);
  const valid = isValid(property, text);

  useEffect(() => setText(value), [value, scope]);

  function handleText(next: string) {
    setText(next);
    if (isValid(property, next)) onChange(property.name, next.trim());
  }

  const control =
    property.kind === "font" ? (
      <Select
        options={FONT_FAMILIES.map((family) => ({
          label: family,
          value: `"${family}"`,
        }))}
        value={value}
        onChange={(next) => onChange(property.name, next)}
        size="xs"
        className="w-full"
      />
    ) : (
      <Input
        aria-label={property.name}
        value={text}
        onChange={handleText}
        size="xs"
        error={!valid}
        clearable={false}
        inputClassName="font-mono text-xs"
        prefix={
          property.kind === "color" ? (
            <Swatch value={text} onPick={(hex) => onChange(property.name, hex)} />
          ) : undefined
        }
      />
    );

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_auto] items-center gap-2">
      <span
        className={cn("truncate font-mono text-xs", {
          "text-link-color font-semibold": edited,
          "text-ds-text-body": !edited,
        })}
        title={property.name}
      >
        {property.name}
      </span>
      {control}
      <button
        type="button"
        aria-label={`Reset ${property.name}`}
        title="Reset to the base value"
        disabled={!edited}
        onClick={() => onClear(property.name)}
        className="p-1 rounded hover:bg-btn-ghost-bg-hover disabled:opacity-30 disabled:pointer-events-none"
      >
        <Icon id="radix-icons-reset" className="size-3.5" />
      </button>
    </div>
  );
}

export function PropertyList({ scope }: { scope: ThemeScope }) {
  const draft = useShallowThemePresetsStore((state) => state.draft);
  const overrides = draft[scope];
  const inherited = scope === "dark" ? draft.light : {};
  const setValue = useThemePresetsStore((state) => state.setValue);
  const clearValue = useThemePresetsStore((state) => state.clearValue);
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return THEME_GROUPS.map((group) => ({
      group,
      properties: THEME_PROPERTIES.filter(
        (property) => property.group === group && property.name.includes(needle),
      ),
    })).filter(({ properties }) => properties.length > 0);
  }, [query]);

  function deriveBrand() {
    const brand = overrides["--color-main-100"];
    const hex = brand && HEX_COLOR.test(brand) ? brand : null;
    if (!hex) return;
    for (const [name, value] of Object.entries(DERIVED_SHADES)) {
      setValue(scope, name, value);
    }
    setValue(scope, "--color-main-contrast", getContrastTextColor(hex));
  }

  const brandIsHex = HEX_COLOR.test(overrides["--color-main-100"] ?? "");

  return (
    <div className="flex flex-col gap-3">
      <Input
        aria-label="Search properties"
        placeholder="Search properties"
        value={query}
        onChange={setQuery}
        size="sm"
        prefix={<Icon id="search" className="size-4" />}
      />
      {groups.map(({ group, properties }) => (
        <SettingsMenu
          key={group}
          title={`${group} (${properties.length})`}
          canCollapse={true}
          defaultOpen={group === BRAND_GROUP}
          open={query ? true : undefined}
          rightElement={
            group === BRAND_GROUP ? (
              <Button
                variant="outlined"
                size="xs"
                disabled={!brandIsHex}
                onClick={deriveBrand}
              >
                Derive from brand color
              </Button>
            ) : undefined
          }
        >
          <div className="flex flex-col gap-2 p-3">
            {properties.map((property) => {
              const edited = property.name in overrides;
              return (
                <PropertyRow
                  key={property.name}
                  property={property}
                  scope={scope}
                  value={
                    overrides[property.name] ??
                    inherited[property.name] ??
                    baseValue(property, scope)
                  }
                  edited={edited}
                  onChange={(name, value) => setValue(scope, name, value)}
                  onClear={(name) => clearValue(scope, name)}
                />
              );
            })}
          </div>
        </SettingsMenu>
      ))}
      {groups.length === 0 && (
        <p className="text-xs text-ds-text-caption">No property matches the search.</p>
      )}
    </div>
  );
}

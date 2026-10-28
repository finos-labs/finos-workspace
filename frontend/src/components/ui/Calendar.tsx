import type * as React from "react";
import { Children, isValidElement } from "react";
import { DayPicker, type SelectProps } from "react-day-picker";
import { cn } from "~/lib/utils";
import { Select, type SelectOptionObject } from "../ds/atoms/Select";

export type CalendarProps = React.ComponentProps<typeof DayPicker> & {
  isSingle?: boolean;
};

const currentYear = new Date().getFullYear();
const MAX_DATE = new Date(currentYear + 5, 11, 31);
const MIN_DATE = new Date(currentYear - 90, 0, 1);

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  isSingle = false,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      startMonth={MIN_DATE}
      endMonth={MAX_DATE}
      showOutsideDays={showOutsideDays}
      className={cn("p-2 [&_table]:border-separate!", className)}
      classNames={{
        weekday: "text-dark-50 font-normal",
        months: "flex",
        month_grid: "p-1",
        disabled: "bg-light-50! text-light-200! dark:text-dark-500! dark:bg-dark-700!",
        month_caption: "text-center",
        dropdown: "ws-minimal-input h-6 p-0.5",
        dropdowns: "grid grid-cols-[minmax(0,1fr)_auto] gap-1 px-6",
        caption: "flex justify-center pt-1 relative items-center",
        caption_label: "text-sm font-medium hidden",
        head_row: "flex",
        nav: "space-x-1 flex items-center",
        table: "w-full border-separate! border-spacing-1",
        row: "flex w-full",
        day: "bg-light-100 dark:bg-dark-500 min-w-6 size-6 rounded !p-0",
        selected: "bg-light-300! dark:bg-dark-300!",
        day_button: "w-full h-full",
        hidden: "bg-light-50! text-light-200! dark:text-dark-500! dark:bg-dark-700!",
        outside: "bg-light-50! text-light-200! dark:text-dark-500! dark:bg-dark-700!",
        button_next: cn(
          "ws-minimal-input",
          "flex items-center justify-center h-6 w-2 absolute right-3 top-[9px]",
        ),
        button_previous: cn(
          "ws-minimal-input",
          "flex items-center justify-center h-6 w-2 absolute left-3 top-[9px]",
        ),
        chevron: "shrink-0 fill-light-400 size-2",
        ...classNames,
      }}
      components={isSingle ? { Select: SelectComponent } : undefined}
      {...props}
    />
  );
}
Calendar.displayName = "Calendar";

const SelectComponent = ({
  value,
  onChange,
  children,
  className,
  disabled,
}: SelectProps) => {
  const options = Children.toArray(children).flatMap((child): SelectOptionObject[] =>
    isValidElement<React.ComponentProps<"option">>(child)
      ? [{ label: String(child.props.children), value: String(child.props.value) }]
      : [],
  );

  return (
    <Select
      disabled={disabled}
      size="xs"
      className={cn(className, "[&_svg]:size-3")}
      value={value === undefined ? undefined : String(value)}
      onChange={(newValue) => {
        const syntheticEvent = {
          target: {
            value: newValue,
          },
        } as React.ChangeEvent<HTMLSelectElement>;

        onChange?.(syntheticEvent);
      }}
      options={options}
    />
  );
};

export { Calendar };

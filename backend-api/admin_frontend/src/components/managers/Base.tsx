import { BaseDialog, DialogTitle } from "ui/Dialog";
import { clsx } from "clsx";
import React, { type ComponentType, useState } from "react";
import type { Paginated, User } from "utils/requests";

type RetrieveItems = (search?: string) => Promise<void>;

interface TableBodyProps<T> {
  items: T[];
  columns: string[];
  setShow: (set: boolean) => void;
  setItem: (set: T) => void;
}

export interface SubmitFormProps<T, V> {
  user: User;
  setShowAdd: (set: boolean) => void;
  item?: T;
  setItem: (set: T) => void;
  retrieveItems: () => Promise<void>;
  data: V;
  editType: string;
}

interface SearchBarProps {
  retrieveItems: RetrieveItems;
}

/**
 * T is the type of a row and V what the form needs besides the row, such as the
 * options of a select. A form that needs nothing takes an empty record.
 */
interface ManageBaseProps<T, V> {
  user: User;
  headers: string[];
  title: string;
  SubmitForm: ComponentType<SubmitFormProps<T, V>>;
  columns: string[];
  formData: V;
  retrieveItems: RetrieveItems;
  items: Paginated<T>;
  SearchBar?: ComponentType<SearchBarProps>;
}

interface TableHeaderProps {
  headers: string[];
}

function TableHeader({ headers }: TableHeaderProps): JSX.Element {
  return (
    <thead>
      <tr className="border-b border-surface-divider bg-general-bg-secondary">
        {headers.map((header, index) => (
          <th
            className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-ds-text-subtitle"
            key={index}
          >
            {header}
          </th>
        ))}
      </tr>
    </thead>
  );
}

function TableBody<T>({
  items,
  columns,
  setItem,
  setShow,
}: TableBodyProps<T>): JSX.Element {
  if (items !== undefined && items.length < 1) {
    return <></>;
  }

  function handleEdit(row: T) {
    setItem(row);
    setShow(true);
  }

  // The cell of a row for a dotted column such as "entity_type.code"; null when the path leads nowhere
  function getValue(row: T, column: string): string | number | null {
    let value: unknown = row;
    for (const key of column.split(".")) {
      if (typeof value !== "object" || value === null) return null;
      value = Reflect.get(value, key);
    }
    if (typeof value === "boolean") {
      return value ? "true" : "false";
    }
    return typeof value === "string" || typeof value === "number" ? value : null;
  }

  return (
    <tbody>
      {items.map((row: T, i: number) => {
        return (
          <tr className="cursor-pointer border-b border-surface-divider bg-general-bg-primary hover:bg-general-bg-primary-hover" onClick={() => handleEdit(row)} key={i}>
            {columns.map((column: string, i: number) => {
              const value = getValue(row, column);
              return (
                <td className="px-5 py-3 text-xs text-ds-text-body" key={i}>
                  {value ?? "-"}
                </td>
              );
            })}
          </tr>
        );
      })}
    </tbody>
  );
}

export function ManageBase<T, V>({
  user,
  headers,
  title,
  SubmitForm,
  columns,
  formData,
  retrieveItems,
  items,
  SearchBar,
}: ManageBaseProps<T, V>): JSX.Element {
  const [show, setShow] = useState(false);
  const [item, setItem] = useState<undefined | T>();
  const editType = item ? "Edit" : "Add";

  const prepareAdd = (show: boolean): void => {
    setItem(undefined);
    setShow(show);
  };

  return (
    <div className="ws-card overflow-hidden">
      {show && (
        <BaseDialog open={show} onClose={() => prepareAdd(false)}>
          <DialogTitle>{`${title} ${editType}`}</DialogTitle>
          <SubmitForm
            user={user}
            setShowAdd={setShow}
            retrieveItems={retrieveItems}
            data={formData}
            setItem={setItem}
            item={item}
            editType={editType}
          />
        </BaseDialog>
      )}
      <div
        className={clsx("ws-card-header flex items-center gap-2", {
          "justify-end": SearchBar === undefined,
          "justify-between": SearchBar !== undefined,
        })}
      >
        {SearchBar !== undefined && <SearchBar retrieveItems={retrieveItems} />}
        <button type="button" className="ws-btn-blue" onClick={() => prepareAdd(true)}>
          Add
        </button>
      </div>
      <div className="ws-card-content">
        <table className="w-full overflow-hidden rounded border border-general-border-primary">
          <TableHeader headers={headers} />
          <TableBody
            items={items.items}
            columns={columns}
            setShow={setShow}
            setItem={setItem}
          />
        </table>
        {items.items.length === 0 && (
          <div className="py-6 text-center text-xs text-ds-text-subtitle">
            No {title.toLowerCase()} records found.
          </div>
        )}
      </div>
    </div>
  );
}

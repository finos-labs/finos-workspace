import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useCallback, useMemo, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataTableColumn } from "~/components/ds/molecules/DataTable";
import { DataTable } from "~/components/ds/molecules/DataTable";

type Row = { id: string; name: string; age: number };

const makeData = (n: number): Row[] =>
  Array.from({ length: n }, (_, i) => ({
    id: String(i + 1),
    name: `User ${i + 1}`,
    age: 20 + i,
  }));

const columns: DataTableColumn<Row>[] = [
  { id: "name", header: "Name", width: "auto", cell: (r) => r.name, sortable: true },
  { id: "age", header: "Age", width: 80, align: "right", cell: (r) => r.age },
];

const getRowId = (r: Row) => r.id;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DataTable", () => {
  it("renders columns and rows as a semantic table (non-virtualized)", () => {
    render(<DataTable columns={columns} data={makeData(3)} getRowId={getRowId} />);

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader")).toHaveLength(2);
    expect(screen.getAllByRole("row")).toHaveLength(4);
    expect(screen.getByText("User 1")).toBeInTheDocument();
    expect(screen.getByText("User 3")).toBeInTheDocument();
  });

  it("exposes explicit ARIA grid roles when virtualized", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 800,
      height: 400,
      top: 0,
      left: 0,
      right: 800,
      bottom: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    const originalRO = global.ResizeObserver;
    global.ResizeObserver = class {
      private cb: ResizeObserverCallback;
      constructor(cb: ResizeObserverCallback) {
        this.cb = cb;
      }
      observe(el: Element) {
        this.cb(
          [
            {
              target: el,
              contentRect: { width: 800, height: 400 } as DOMRectReadOnly,
              borderBoxSize: [{ inlineSize: 800, blockSize: 400 }],
            } as unknown as ResizeObserverEntry,
          ],
          this as unknown as ResizeObserver,
        );
      }
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;

    try {
      render(
        <DataTable
          columns={columns}
          data={makeData(5)}
          getRowId={getRowId}
          virtualized
          estimateRowHeight={50}
          maxHeight={400}
        />,
      );

      expect(screen.getByRole("grid")).toBeInTheDocument();
      expect(screen.getAllByRole("columnheader")).toHaveLength(2);
      await waitFor(() => {
        expect(screen.getAllByRole("gridcell").length).toBeGreaterThan(0);
      });
      expect(screen.getAllByRole("row").length).toBeGreaterThan(1);
    } finally {
      global.ResizeObserver = originalRO;
    }
  });

  it("reserves a min-width floor for flexible columns so they cannot collapse", () => {
    const cols: DataTableColumn<Row>[] = [
      { id: "name", header: "Name", width: "auto", minWidth: 160, cell: (r) => r.name },
      { id: "age", header: "Age", width: 80, cell: (r) => r.age },
    ];
    render(<DataTable columns={cols} data={makeData(1)} getRowId={getRowId} />);
    expect(screen.getByRole("table")).toHaveStyle({ minWidth: "240px" });
  });

  it("hugs its content by default (sizes to the column floor, not 100%)", () => {
    const cols: DataTableColumn<Row>[] = [
      { id: "name", header: "Name", width: "auto", minWidth: 160, cell: (r) => r.name },
      { id: "age", header: "Age", width: 80, cell: (r) => r.age },
    ];
    render(<DataTable columns={cols} data={makeData(1)} getRowId={getRowId} />);
    expect(screen.getByRole("table")).toHaveStyle({ width: "240px" });
  });

  it("fills the container when a column uses a percentage width", () => {
    const cols: DataTableColumn<Row>[] = [
      { id: "name", header: "Name", width: "60%", minWidth: 160, cell: (r) => r.name },
      { id: "age", header: "Age", width: 80, cell: (r) => r.age },
    ];
    render(<DataTable columns={cols} data={makeData(1)} getRowId={getRowId} />);
    expect(screen.getByRole("table")).toHaveStyle({ width: "100%" });
  });

  it("stretches to fill when a column opts into width:'fill'", () => {
    const cols: DataTableColumn<Row>[] = [
      { id: "name", header: "Name", width: "fill", minWidth: 160, cell: (r) => r.name },
      { id: "age", header: "Age", width: 80, cell: (r) => r.age },
    ];
    render(<DataTable columns={cols} data={makeData(1)} getRowId={getRowId} />);
    const table = screen.getByRole("table");
    expect(table).toHaveStyle({ width: "100%" });
    expect(table).toHaveStyle({ minWidth: "240px" });
  });

  it("emits a toggled sort state when a sortable header is clicked", () => {
    const onSortChange = vi.fn();
    const { rerender } = render(
      <DataTable
        columns={columns}
        data={makeData(2)}
        getRowId={getRowId}
        sortState={null}
        onSortChange={onSortChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Name/ }));
    expect(onSortChange).toHaveBeenCalledWith({ id: "name", dir: "asc" });

    rerender(
      <DataTable
        columns={columns}
        data={makeData(2)}
        getRowId={getRowId}
        sortState={{ id: "name", dir: "asc" }}
        onSortChange={onSortChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Name/ }));
    expect(onSortChange).toHaveBeenLastCalledWith({ id: "name", dir: "desc" });
  });

  it("does not render a sort affordance for non-sortable columns", () => {
    render(<DataTable columns={columns} data={makeData(1)} getRowId={getRowId} />);
    expect(screen.getByRole("button", { name: /Name/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Age/ })).not.toBeInTheDocument();
  });

  it("toggles a single row and select-all via the selection column", () => {
    const onToggleRow = vi.fn();
    const onToggleAll = vi.fn();
    render(
      <DataTable
        columns={columns}
        data={makeData(2)}
        getRowId={getRowId}
        selectedIds={new Set()}
        onToggleRow={onToggleRow}
        onToggleAll={onToggleAll}
      />,
    );

    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(3);

    fireEvent.click(checkboxes[1]);
    expect(onToggleRow).toHaveBeenCalledWith("1", true);

    fireEvent.click(checkboxes[0]);
    expect(onToggleAll).toHaveBeenCalledWith(expect.any(Array), true);
    expect(onToggleAll.mock.calls[0][0]).toHaveLength(2);
  });

  it("shows the header checkbox as indeterminate on a partial selection", () => {
    render(
      <DataTable
        columns={columns}
        data={makeData(2)}
        getRowId={getRowId}
        selectedIds={new Set(["1"])}
        onToggleRow={vi.fn()}
        onToggleAll={vi.fn()}
      />,
    );
    expect(screen.getAllByRole("checkbox")[0]).toHaveAttribute(
      "data-state",
      "indeterminate",
    );
  });

  it("disables checkboxes for non-selectable rows", () => {
    render(
      <DataTable
        columns={columns}
        data={makeData(2)}
        getRowId={getRowId}
        selectedIds={new Set()}
        onToggleRow={vi.fn()}
        isRowSelectable={(r) => r.id !== "2"}
      />,
    );
    const row = screen.getByText("User 2").closest("tr") as HTMLElement;
    expect(within(row).getByRole("checkbox")).toBeDisabled();
  });

  it("renders row actions and the empty state", () => {
    const { rerender } = render(
      <DataTable
        columns={columns}
        data={makeData(1)}
        getRowId={getRowId}
        renderRowActions={(r) => <button type="button">Edit {r.name}</button>}
      />,
    );
    expect(screen.getByRole("button", { name: "Edit User 1" })).toBeInTheDocument();

    rerender(
      <DataTable
        columns={columns}
        data={[]}
        getRowId={getRowId}
        emptyState={<div>No results</div>}
      />,
    );
    expect(screen.getByText("No results")).toBeInTheDocument();
  });

  it("re-renders only the toggled row on a selection change (memoized rows)", () => {
    const renders = new Map<string, number>();

    function Harness() {
      const [selected, setSelected] = useState<Set<string>>(new Set());
      const cols = useMemo<DataTableColumn<Row>[]>(
        () => [
          {
            id: "name",
            header: "Name",
            width: "auto",
            cell: (r) => {
              renders.set(r.id, (renders.get(r.id) ?? 0) + 1);
              return r.name;
            },
          },
        ],
        [],
      );
      const onToggleRow = useCallback((id: string, checked: boolean) => {
        setSelected((prev) => {
          const next = new Set(prev);
          checked ? next.add(id) : next.delete(id);
          return next;
        });
      }, []);
      return (
        <DataTable
          columns={cols}
          data={data}
          getRowId={getRowId}
          selectedIds={selected}
          onToggleRow={onToggleRow}
        />
      );
    }
    const data = makeData(3);

    render(<Harness />);
    const row2Before = renders.get("2") ?? 0;
    const row1Before = renders.get("1") ?? 0;

    fireEvent.click(screen.getAllByRole("checkbox")[1]);

    expect(renders.get("1") ?? 0).toBeGreaterThan(row1Before);
    expect(renders.get("2") ?? 0).toBe(row2Before);
  });
});

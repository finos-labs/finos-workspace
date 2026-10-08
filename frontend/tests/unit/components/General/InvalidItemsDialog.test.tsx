import { act, fireEvent, render, screen } from "@testing-library/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import InvalidItemsDialog from "~/components/General/InvalidItemsDialog";
import { useInvalidItemsStore } from "~/lib/state/invalidItems";
import type { InvalidItem } from "~/lib/utils/invalidItems";
import { forgetInvalidItems, showInvalidItemsToast } from "~/utils/zodErrors";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    warning: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("~/components/ds/dialogs/BaseDialog", () => ({
  BaseDialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
}));

vi.mock("~/components/ds/dialogs/Dialog", () => ({
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const items: InvalidItem[] = [
  {
    file: "widgets.json",
    id: "stock_price",
    name: "Stock Price",
    errors: "Stock Price (stock_price):\n [endpoint]: Invalid input: expected string",
    json: '{\n  "name": "Stock Price"\n}',
  },
  {
    file: "widgets.json",
    id: "second",
    errors: "second:\n [description]: required",
    json: "{}",
  },
  {
    file: "apps.json",
    id: "Broken App",
    name: "Broken App",
    errors: "Broken App:\n [tabs]: Invalid input: expected object",
    json: '{\n  "name": "Broken App"\n}',
  },
];

describe("showInvalidItemsToast", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    forgetInvalidItems(["b1"]);
    useInvalidItemsStore.getState().close();
  });

  it("warns how many widgets and apps were skipped, with a way to inspect them", () => {
    showInvalidItemsToast({ id: "b1", name: "My Backend" }, items);

    expect(toast.warning).toHaveBeenCalledTimes(1);
    const [title, options] = (toast.warning as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(title).toBe("Invalid items in My Backend");
    expect(options.description).toBe("2 widgets and 1 app could not be loaded.");
    expect(options.action.label).toBe("Inspect");
    // One toast per backend, replaced on the next load rather than stacked
    expect(options.id).toBe("backend-invalid-items-b1");
  });

  it("opens the details when the toast is clicked", () => {
    showInvalidItemsToast({ id: "b1", name: "My Backend" }, items);
    const [, options] = (toast.warning as ReturnType<typeof vi.fn>).mock.calls[0];

    act(() => options.action.onClick());

    expect(useInvalidItemsStore.getState().sourceName).toBe("My Backend");
    expect(useInvalidItemsStore.getState().items).toEqual(items);
  });

  it("announces a problem once, unless the user asked for it again", () => {
    showInvalidItemsToast({ id: "b1", name: "My Backend" }, items);
    showInvalidItemsToast({ id: "b1", name: "My Backend" }, items);
    expect(toast.warning).toHaveBeenCalledTimes(1);

    showInvalidItemsToast({ id: "b1", name: "My Backend" }, items, { force: true });
    expect(toast.warning).toHaveBeenCalledTimes(2);
  });

  it("announces a changed problem again", () => {
    showInvalidItemsToast({ id: "b1", name: "My Backend" }, items);
    showInvalidItemsToast({ id: "b1", name: "My Backend" }, items.slice(0, 1));

    expect(toast.warning).toHaveBeenCalledTimes(2);
  });

  it("stays quiet when nothing is invalid", () => {
    showInvalidItemsToast({ id: "b1", name: "My Backend" }, []);

    expect(toast.warning).not.toHaveBeenCalled();
  });
});

describe("InvalidItemsDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useInvalidItemsStore.getState().close();
  });

  it("is closed until the toast opens it", () => {
    render(<InvalidItemsDialog />);

    expect(screen.queryByTestId("dialog")).not.toBeInTheDocument();
  });

  it("lists every invalid item with what is wrong with it", () => {
    useInvalidItemsStore.getState().show("My Backend", items);
    render(<InvalidItemsDialog />);

    expect(screen.getByText("Invalid items in My Backend")).toBeInTheDocument();
    expect(screen.getAllByTestId("invalid-item")).toHaveLength(3);
    expect(screen.getByText("Widgets (2)")).toBeInTheDocument();
    expect(screen.getByText("Apps (1)")).toBeInTheDocument();
    expect(screen.getByText(/\[endpoint\]/)).toBeInTheDocument();
    expect(screen.getByText(/\[tabs\]/)).toBeInTheDocument();
    expect(screen.getByText(/"name": "Broken App"/)).toBeInTheDocument();
  });

  it("closes", () => {
    useInvalidItemsStore.getState().show("My Backend", items);
    render(<InvalidItemsDialog />);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(useInvalidItemsStore.getState().sourceName).toBeNull();
  });

  it("copies the details", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    useInvalidItemsStore.getState().show("My Backend", items);
    render(<InvalidItemsDialog />);

    fireEvent.click(screen.getByRole("button", { name: "Copy details" }));

    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const text = writeText.mock.calls[0][0] as string;
    expect(text).toContain("Invalid items in My Backend");
    expect(text).toContain("[widgets.json] Stock Price (stock_price)");
    expect(text).toContain("[apps.json] Broken App");
    expect(toast.success).toHaveBeenCalled();
  });
});

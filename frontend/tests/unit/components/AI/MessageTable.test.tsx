import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import MessageTable from "~/components/AI/MessageTable";

vi.mock("usehooks-ts", () => ({
  useLocalStorage: vi.fn().mockReturnValue(["", vi.fn()]),
}));

// Avoid toasts during tests
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// The copy action writes the extracted rows to the clipboard as TSV
async function copyTable(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button"));
  return (await navigator.clipboard.readText()).split("\n");
}

describe("MessageTable extraction", () => {
  it("extracts rows from the provided table children and copies them", async () => {
    const user = userEvent.setup();

    render(
      <MessageTable>
        <thead>
          <tr>
            <th> Date </th>
            <th> Open </th>
            <th> High </th>
            <th> Low </th>
            <th> Close </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td> 2025-08-31 </td>
            <td> 202.86 </td>
            <td> 206.51 </td>
            <td> 200.66 </td>
            <td> 200.86 </td>
          </tr>
          <tr>
            <td> 2025-09-01 </td>
            <td> 200.86 </td>
            <td> 204.22 </td>
            <td> 194.38 </td>
            <td> 197.11 </td>
          </tr>
          <tr>
            <td> 2025-09-02 </td>
            <td> 197.11 </td>
            <td> 209.48 </td>
            <td> 197.09 </td>
            <td> 209.48 </td>
          </tr>
          <tr>
            <td> 2025-09-03 </td>
            <td> 209.48 </td>
            <td> 212.82 </td>
            <td> 207.58 </td>
            <td> 210.75 </td>
          </tr>
          <tr>
            <td> 2025-09-04 </td>
            <td> 210.75 </td>
            <td> 211.80 </td>
            <td> 202.13 </td>
            <td> 202.56 </td>
          </tr>
          <tr>
            <td> 2025-09-05 </td>
            <td> 202.55 </td>
            <td> 209.86 </td>
            <td> 201.18 </td>
            <td> 203.50 </td>
          </tr>
          <tr>
            <td> 2025-09-06 </td>
            <td> 203.50 </td>
            <td> 204.56 </td>
            <td> 199.64 </td>
            <td> 200.25 </td>
          </tr>
          <tr>
            <td> 2025-09-07 </td>
            <td> 200.25 </td>
            <td> 207.87 </td>
            <td> 200.23 </td>
            <td> 206.47 </td>
          </tr>
          <tr>
            <td> 2025-09-08 </td>
            <td> 206.46 </td>
            <td> 216.90 </td>
            <td> 205.72 </td>
            <td> 214.19 </td>
          </tr>
          <tr>
            <td> 2025-09-09 </td>
            <td> 214.19 </td>
            <td> 219.52 </td>
            <td> 211.16 </td>
            <td> 217.25 </td>
          </tr>
          <tr>
            <td> 2025-09-10 </td>
            <td> 217.25 </td>
            <td> 225.51 </td>
            <td> 215.27 </td>
            <td> 223.99 </td>
          </tr>
          <tr>
            <td> 2025-09-11 </td>
            <td> 223.99 </td>
            <td> 228.91 </td>
            <td> 222.03 </td>
            <td> 228.76 </td>
          </tr>
          <tr>
            <td> 2025-09-12 </td>
            <td> 228.76 </td>
            <td> 243.79 </td>
            <td> 228.26 </td>
            <td> 242.30 </td>
          </tr>
          <tr>
            <td> 2025-09-13 </td>
            <td> 242.30 </td>
            <td> 244.14 </td>
            <td> 236.47 </td>
            <td> 242.60 </td>
          </tr>
          <tr>
            <td> 2025-09-14 </td>
            <td> 242.60 </td>
            <td> 249.12 </td>
            <td> 240.21 </td>
            <td> 240.56 </td>
          </tr>
          <tr>
            <td> 2025-09-15 </td>
            <td> 240.55 </td>
            <td> 244.00 </td>
            <td> 230.48 </td>
            <td> 234.36 </td>
          </tr>
          <tr>
            <td> 2025-09-16 </td>
            <td> 234.36 </td>
            <td> 240.68 </td>
            <td> 231.87 </td>
            <td> 236.99 </td>
          </tr>
          <tr>
            <td> 2025-09-17 </td>
            <td> 236.98 </td>
            <td> 246.46 </td>
            <td> 232.77 </td>
            <td> 244.86 </td>
          </tr>
          <tr>
            <td> 2025-09-18 </td>
            <td> 244.85 </td>
            <td> 253.21 </td>
            <td> 242.91 </td>
            <td> 247.64 </td>
          </tr>
          <tr>
            <td> 2025-09-19 </td>
            <td> 247.64 </td>
            <td> 248.51 </td>
            <td> 235.87 </td>
            <td> 238.55 </td>
          </tr>
          <tr>
            <td> 2025-09-20 </td>
            <td> 238.55 </td>
            <td> 241.00 </td>
            <td> 237.18 </td>
            <td> 239.59 </td>
          </tr>
          <tr>
            <td> 2025-09-21 </td>
            <td> 239.59 </td>
            <td> 241.81 </td>
            <td> 235.72 </td>
            <td> 236.58 </td>
          </tr>
          <tr>
            <td> 2025-09-22 </td>
            <td> 236.57 </td>
            <td> 236.87 </td>
            <td> 216.92 </td>
            <td> 220.50 </td>
          </tr>
          <tr>
            <td> 2025-09-23 </td>
            <td> 220.50 </td>
            <td> 221.35 </td>
            <td> 212.80 </td>
            <td> 213.72 </td>
          </tr>
          <tr>
            <td> 2025-09-24 </td>
            <td> 213.71 </td>
            <td> 216.38 </td>
            <td> 206.04 </td>
            <td> 211.76 </td>
          </tr>
          <tr>
            <td> 2025-09-25 </td>
            <td> 211.75 </td>
            <td> 212.40 </td>
            <td> 192.08 </td>
            <td> 192.38 </td>
          </tr>
          <tr>
            <td> 2025-09-26 </td>
            <td> 192.40 </td>
            <td> 205.42 </td>
            <td> 191.13 </td>
            <td> 205.35 </td>
          </tr>
          <tr>
            <td> 2025-09-27 </td>
            <td> 205.35 </td>
            <td> 205.40 </td>
            <td> 200.27 </td>
            <td> 203.58 </td>
          </tr>
          <tr>
            <td> 2025-09-28 </td>
            <td> 203.58 </td>
            <td> 210.90 </td>
            <td> 198.32 </td>
            <td> 210.74 </td>
          </tr>
          <tr>
            <td> 2025-09-29 </td>
            <td> 210.74 </td>
            <td> 214.69 </td>
            <td> 205.13 </td>
            <td> 213.05 </td>
          </tr>
          <tr>
            <td> 2025-09-30 </td>
            <td> 213.03 </td>
            <td> 213.46 </td>
            <td> 205.25 </td>
            <td> 205.67 </td>
          </tr>
        </tbody>
      </MessageTable>,
    );

    const lines = await copyTable(user);

    // Header line plus 31 rows: Aug 31 + Sep (30 days)
    expect(lines).toHaveLength(32);
    expect(lines[0]).toBe("Date\tOpen\tHigh\tLow\tClose");
    expect(lines[1]).toBe("2025-08-31\t202.86\t206.51\t200.66\t200.86");
    expect(lines.at(-1)).toBe("2025-09-30\t213.03\t213.46\t205.25\t205.67");
  });

  it("handles empty headers gracefully", async () => {
    const user = userEvent.setup();

    render(
      <MessageTable>
        <thead>
          <tr>
            <th> </th>
            <th> 3Q 25 </th>
            <th> 2Q 25 </th>
            <th> 3Q 24 </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td> Premiums, service revenue earned and other income </td>
            <td> $364 </td>
            <td> $1 </td>
            <td> $2 </td>
          </tr>
          <tr>
            <td> VSC losses </td>
            <td> 34 </td>
            <td> (1) </td>
            <td> (2) </td>
          </tr>
          <tr>
            <td> Weather losses </td>
            <td> 22 </td>
            <td> (69) </td>
            <td> (4) </td>
          </tr>
          <tr>
            <td> All other losses </td>
            <td> 85 </td>
            <td> 8 </td>
            <td> 12 </td>
          </tr>
          <tr>
            <td> Losses and loss adjustment expenses </td>
            <td> 141 </td>
            <td> (62) </td>
            <td> 6 </td>
          </tr>
          <tr>
            <td> Acquisition and underwriting expenses (2) </td>
            <td> 233 </td>
            <td> 12 </td>
            <td> 3 </td>
          </tr>
          <tr>
            <td> Total underwriting income/(loss) </td>
            <td> (10) </td>
            <td> 51 </td>
            <td> (7) </td>
          </tr>
          <tr>
            <td> Investment income and other </td>
            <td> 89 </td>
            <td> - </td>
            <td> (16) </td>
          </tr>
          <tr>
            <td> Pre-tax income (loss) </td>
            <td> $79 </td>
            <td> $51 </td>
            <td> $(23) </td>
          </tr>
          <tr>
            <td> Change in fair value of equity securities (3) </td>
            <td> (27) </td>
            <td> 3 </td>
            <td> 29 </td>
          </tr>
          <tr>
            <td> Core pre-tax income (loss) </td>
            <td> $52 </td>
            <td> $54 </td>
            <td> $6 </td>
          </tr>
          <tr>
            <td> Total assets (EOP) </td>
            <td> $9,848 </td>
            <td> $143 </td>
            <td> $393 </td>
          </tr>
        </tbody>
      </MessageTable>,
    );

    const lines = await copyTable(user);

    // Header line plus 12 rows; the empty header falls back to a positional name
    expect(lines).toHaveLength(13);
    expect(lines[0]).toBe("Column 1\t3Q 25\t2Q 25\t3Q 24");
    expect(lines[1]).toBe(
      "Premiums, service revenue earned and other income\t364\t1\t2",
    );
    expect(lines.at(-1)).toBe("Total assets (EOP)\t9848\t143\t393");
  });
});

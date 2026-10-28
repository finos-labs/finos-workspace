export const GROUP_FIELDS = ["sector", "industry", "state", "size"] as const;
export type GroupField = (typeof GROUP_FIELDS)[number];

export const MEASURES = ["revenueUsdM", "employees"] as const;
export type Measure = (typeof MEASURES)[number];

export const AGGREGATIONS = ["sum", "avg", "min", "max"] as const;
export type Aggregation = (typeof AGGREGATIONS)[number];

export const COMPANY_SIZES = ["Small", "Mid", "Large"] as const;
export type CompanySize = (typeof COMPANY_SIZES)[number];

export interface CompanyRow {
  id: string;
  company: string;
  sector: string;
  industry: string;
  state: string;
  size: CompanySize;
  revenueUsdM: number;
  employees: number;
  foundedYear: number;
}

export const FIELD_LABELS: Record<
  GroupField | Measure | "company" | "foundedYear",
  string
> = {
  company: "Company",
  sector: "Sector",
  industry: "Industry",
  state: "State",
  size: "Size",
  revenueUsdM: "Revenue ($M)",
  employees: "Employees",
  foundedYear: "Founded",
};

/**
 * What the view shows. In Workspace the data comes from the host (the widget's endpoint),
 * so there is no API URL; exports go through Workspace's own menu, so the grid's export
 * button stays off.
 */
export interface AdvancedGroupingConfig {
  name: string;
  /** Feature flags. A disabled feature also hides its controls. */
  features: {
    grouping: boolean;
    aggregation: boolean;
    export: boolean;
    search: boolean;
  };
  defaults: {
    groupBy: GroupField[];
    aggregation: Aggregation;
  };
}

export const CONFIG: AdvancedGroupingConfig = {
  name: "BQ Advanced Grouping",
  features: { grouping: true, aggregation: true, export: false, search: true },
  defaults: { groupBy: ["sector", "state"], aggregation: "sum" },
};

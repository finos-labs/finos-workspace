import type { ComponentProps } from "react";
import type { User } from "~/types/user.type";
import { Tag } from "../ds/atoms/Tag";

const statusColors: Partial<Record<string, ComponentProps<typeof Tag>["color"]>> = {
  inactive: "grey",
  active: "success",
};

interface Props {
  value: User["billing_active"];
}

export default function AdminUserBillingStatus(props: Props) {
  const { value } = props;
  const displayValue = value ? "Active" : "Inactive";
  const color = statusColors[displayValue.toLowerCase()] || "grey";
  return (
    <Tag color={color} className="capitalize">
      {displayValue}
    </Tag>
  );
}

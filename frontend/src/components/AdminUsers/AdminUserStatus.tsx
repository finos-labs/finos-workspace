import type { ComponentProps } from "react";
import type { User } from "~/types/user.type";
import { Tag } from "../ds/atoms/Tag";

const statusColors: Partial<Record<string, ComponentProps<typeof Tag>["color"]>> = {
  pending: "warning",
  verified: "success",
};

interface Props {
  value: User["status"];
}

export default function AdminUserStatus(props: Props) {
  const { value } = props;
  const displayValue = value.replace("active", "verified") || "-";
  const color = statusColors[displayValue.toLowerCase()] || "grey";
  return (
    <Tag data-testid="user-status" color={color} className="capitalize w-fit">
      {displayValue}
    </Tag>
  );
}

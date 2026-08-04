export type AccountStatus = "active" | "suspended" | "banned" | "deleted";

export const accountStatuses = [
  "active",
  "suspended",
  "banned",
  "deleted",
] as const satisfies readonly AccountStatus[];

export function isAccountStatus(value: string): value is AccountStatus {
  return (accountStatuses as readonly string[]).includes(value);
}

export function accountStatusLabel(status: AccountStatus) {
  return {
    active: "正常",
    suspended: "暂时停用",
    banned: "永久封禁",
    deleted: "已删除",
  }[status];
}

import type { AccountStatus } from "./account";

type AccountStatusRow = { status: AccountStatus };

export async function loadAccountStatus(
  database: D1Database,
  userId: string,
): Promise<AccountStatus> {
  const row = await database
    .prepare("SELECT status FROM user WHERE id = ? LIMIT 1")
    .bind(userId)
    .first<AccountStatusRow>();
  return row?.status ?? "deleted";
}

export async function isAccountActive(database: D1Database, userId: string) {
  return (await loadAccountStatus(database, userId)) === "active";
}

export function assertAccountStatus(status: AccountStatus) {
  if (status !== "active") {
    throw new Response("Account unavailable", { status: 403 });
  }
}

export {
  accountStatusLabel,
  accountStatuses,
  isAccountStatus,
} from "./account";

import { describe, expect, it } from "vitest";

import {
  claimInboxActivity,
  completeInboxActivity,
  releaseInboxActivity,
  rejectInboxActivity,
  validateInboxActivity,
} from "@/modules/federation/inbox";

type CapturedStatement = { sql: string; params: unknown[] };

function receiptDatabase(changes: number | ReadonlyArray<number>) {
  const statements: CapturedStatement[] = [];
  const changePlan = Array.isArray(changes) ? [...changes] : null;
  return {
    database: {
      prepare(sql: string) {
        return {
          bind(...params: unknown[]) {
            const statement = { sql, params };
            statements.push(statement);
            return {
              async run() {
                const next =
                  changePlan === null
                    ? (changes as number)
                    : (changePlan.shift() ?? 0);
                return { meta: { changes: next } };
              },
            };
          },
        };
      },
    } as unknown as D1Database,
    statements,
  };
}

describe("federation inbox receipts", () => {
  const activity = {
    activityId: "https://remote.example/activities/1",
    actorUri: "https://remote.example/users/alice",
  };

  it("accepts only public HTTPS activity and actor identifiers", () => {
    expect(validateInboxActivity(activity)).toEqual({ ok: true });
    expect(
      validateInboxActivity({
        ...activity,
        activityId: "http://remote.example/a",
      }),
    ).toMatchObject({ ok: false });
    expect(
      validateInboxActivity({ ...activity, actorUri: "https://127.0.0.1/a" }),
    ).toMatchObject({ ok: false });
  });

  it("claims a new activity using the receipt primary key", async () => {
    const { database, statements } = receiptDatabase(1);

    await expect(claimInboxActivity(database, activity)).resolves.toBe(true);
    expect(statements[0].sql).toContain("ON CONFLICT(activity_id) DO NOTHING");
    expect(statements[0].params).toEqual(
      expect.arrayContaining([activity.activityId, activity.actorUri]),
    );
  });

  it("treats an existing non-reclaimable receipt as a replay", async () => {
    const { database, statements } = receiptDatabase([0, 0]);

    await expect(claimInboxActivity(database, activity)).resolves.toBe(false);
    expect(statements).toHaveLength(2);
    expect(statements[1]?.sql).toContain("state IN (?)");
    expect(statements[1]?.params.at(-1)).toBe("rejected");
  });

  it("reclaims a rejected receipt for a later delivery of the same activity", async () => {
    const { database, statements } = receiptDatabase([0, 1]);

    await expect(
      claimInboxActivity(database, activity, {
        reclaimStates: ["rejected", "processed"],
      }),
    ).resolves.toBe(true);
    expect(statements[0]?.sql).toContain("ON CONFLICT(activity_id) DO NOTHING");
    expect(statements[1]?.sql).toContain("state IN (?, ?)");
    expect(statements[1]?.params.slice(-2)).toEqual(["rejected", "processed"]);
  });

  it("allows a received activity to be finalized exactly once", async () => {
    const processed = receiptDatabase(1);
    const rejected = receiptDatabase(1);

    await expect(
      completeInboxActivity(processed.database, activity.activityId),
    ).resolves.toBe(true);
    await expect(
      rejectInboxActivity(
        rejected.database,
        activity.activityId,
        "  bad signature  ",
      ),
    ).resolves.toBe(true);
    expect(processed.statements[0].sql).toContain("state = 'received'");
    expect(rejected.statements[0].params).toContain("bad signature");
  });

  it("releases a transiently failed receipt for a Queue retry", async () => {
    const released = receiptDatabase(1);

    await expect(
      releaseInboxActivity(released.database, activity.activityId),
    ).resolves.toBe(true);
    expect(released.statements[0].sql).toContain("state = 'received'");
  });
});

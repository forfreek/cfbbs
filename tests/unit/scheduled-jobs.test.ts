import { describe, expect, it } from "vitest";

import { dailyMaintenanceCron, scheduledWork } from "@/modules/jobs/scheduled";

describe("scheduled Worker work", () => {
  it("runs delivery enqueueing on every short interval", async () => {
    const calls: string[] = [];

    await Promise.all(
      scheduledWork("*/5 * * * *", async () => calls.push("enqueue"), [
        async () => calls.push("retention"),
      ]),
    );

    expect(calls).toEqual(["enqueue"]);
  });

  it("adds retention maintenance to the daily cron", async () => {
    const calls: string[] = [];

    await Promise.all(
      scheduledWork(dailyMaintenanceCron, async () => calls.push("enqueue"), [
        async () => calls.push("retention"),
        async () => calls.push("quarantine"),
      ]),
    );

    expect(calls).toEqual(["enqueue", "retention", "quarantine"]);
  });
});

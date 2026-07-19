export const dailyMaintenanceCron = "0 3 * * *";

export function scheduledWork(
  cron: string,
  recurring: () => Promise<unknown>,
  maintenance: readonly (() => Promise<unknown>)[],
) {
  return cron === dailyMaintenanceCron
    ? [recurring(), ...maintenance.map((job) => job())]
    : [recurring()];
}

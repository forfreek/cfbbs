export function getHealthPayload() {
  return {
    service: "cfbbs",
    status: "ok",
  } as const;
}

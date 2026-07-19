import { expect, it } from "vitest";

import { registeredUsersGroupId } from "@/modules/permissions/system-groups";

it("uses the deterministic seeded registered-users group", () => {
  expect(registeredUsersGroupId).toBe("00000000-0000-0000-0000-000000000003");
});

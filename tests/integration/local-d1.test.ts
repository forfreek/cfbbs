import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFile = promisify(execFileCallback);
const persistenceDirectories: string[] = [];

async function runWrangler(args: string[]) {
  return execFile("pnpm", ["exec", "wrangler", ...args], {
    cwd: process.cwd(),
    env: process.env,
  });
}

afterEach(async () => {
  await Promise.all(
    persistenceDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("local D1 schema", () => {
  it("applies every migration and seeds deterministically from an empty local database", async () => {
    const persistenceDirectory = await mkdtemp(join(tmpdir(), "cfbbs-d1-"));
    persistenceDirectories.push(persistenceDirectory);
    const local = ["--local", "--persist-to", persistenceDirectory];

    await runWrangler(["d1", "migrations", "apply", "cfbbs-local", ...local]);
    const migrated = await runWrangler([
      "d1",
      "execute",
      "cfbbs-local",
      ...local,
      "--command",
      "SELECT (SELECT COUNT(*) FROM groups) AS group_count, (SELECT COUNT(*) FROM boards) AS board_count;",
      "--json",
    ]);

    expect(JSON.parse(migrated.stdout)).toEqual([
      {
        results: [{ group_count: 3, board_count: 2 }],
        success: true,
        meta: expect.any(Object),
      },
    ]);

    await runWrangler([
      "d1",
      "execute",
      "cfbbs-local",
      ...local,
      "--file",
      "app/db/seed.sql",
    ]);
    await runWrangler([
      "d1",
      "execute",
      "cfbbs-local",
      ...local,
      "--file",
      "app/db/seed.sql",
    ]);
    const { stdout } = await runWrangler([
      "d1",
      "execute",
      "cfbbs-local",
      ...local,
      "--command",
      "SELECT (SELECT COUNT(*) FROM groups) AS group_count, (SELECT COUNT(*) FROM boards) AS board_count, (SELECT COUNT(*) FROM local_posts_fts) AS fts_count;",
      "--json",
    ]);

    expect(JSON.parse(stdout)).toEqual([
      {
        results: [
          {
            group_count: 3,
            board_count: 2,
            fts_count: 0,
          },
        ],
        success: true,
        meta: expect.any(Object),
      },
    ]);
  }, 60_000);
});

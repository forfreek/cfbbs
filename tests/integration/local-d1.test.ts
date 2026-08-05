import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFile = promisify(execFileCallback);
const persistenceDirectories: string[] = [];

async function runWrangler(args: string[]) {
  const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  const command = ["pnpm", "exec", "wrangler", ...args.map(shellQuote)].join(
    " ",
  );
  return execFile("/bin/sh", ["-c", `${command} >/dev/null 2>&1`], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "ignore",
  });
}

async function runWranglerToFile(args: string[], outputPath: string) {
  const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  const command = ["pnpm", "exec", "wrangler", ...args.map(shellQuote)].join(
    " ",
  );
  return execFile(
    "/bin/sh",
    ["-c", `${command} >${shellQuote(outputPath)} 2>&1`],
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: "ignore",
    },
  );
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
    const seed = await readFile("app/db/seed.sql", "utf8");
    const verificationSql = join(persistenceDirectory, "verify-seed.sql");
    await writeFile(
      verificationSql,
      [
        "SELECT (SELECT COUNT(*) FROM groups) AS group_count, (SELECT COUNT(*) FROM boards) AS board_count;",
        seed,
        seed,
        "SELECT (SELECT COUNT(*) FROM groups) AS group_count, (SELECT COUNT(*) FROM boards) AS board_count, (SELECT COUNT(*) FROM local_posts_fts) AS fts_count;",
      ].join("\n"),
    );
    const verificationOutput = join(persistenceDirectory, "verification.json");
    await runWranglerToFile(
      [
        "d1",
        "execute",
        "cfbbs-local",
        ...local,
        "--file",
        verificationSql,
        "--json",
      ],
      verificationOutput,
    );
    const results = JSON.parse(
      await readFile(verificationOutput, "utf8"),
    ) as Array<{
      results?: Array<Record<string, number>>;
      success: boolean;
      meta: unknown;
    }>;
    expect(results[0]).toEqual({
      results: [{ group_count: 3, board_count: 2 }],
      success: true,
      meta: expect.any(Object),
    });
    expect(results.at(-1)).toEqual({
      results: [{ group_count: 3, board_count: 2, fts_count: 0 }],
      success: true,
      meta: expect.any(Object),
    });
  }, 300_000);
});

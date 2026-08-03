import { readFileSync } from "node:fs";
import {
  createS3MediaStore,
  parseS3MediaConfig,
} from "../app/modules/media/s3.ts";

const raw = Object.fromEntries(
  readFileSync("s3.env", "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((l) => !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);
const variants = [
  { ...raw },
  { ...raw, S3_REGION: "cn-north-1" },
  { ...raw, S3_FORCE_PATH_STYLE: "false", S3_REGION: "cn-north-1" },
  { ...raw, S3_FORCE_PATH_STYLE: "true", S3_REGION: "cn-north-1" },
];
const key = `media/smoke/${Date.now()}.txt`;
const body = new TextEncoder().encode("cfbbs-s3-smoke").buffer;
for (const [idx, confRaw] of variants.entries()) {
  const conf = parseS3MediaConfig(confRaw);
  if (!conf) {
    console.log(JSON.stringify({ idx, ok: false, error: "bad config" }));
    continue;
  }
  const store = createS3MediaStore(conf);
  try {
    await store.put(key, body, { contentType: "text/plain" });
    const got = await store.get(key);
    const text = got ? new TextDecoder().decode(got) : null;
    await store.delete(key);
    console.log(
      JSON.stringify({
        idx,
        ok: text === "cfbbs-s3-smoke",
        region: conf.region,
        forcePathStyle: conf.forcePathStyle,
        endpoint: conf.endpoint,
        readBack: text,
      }),
    );
    if (text === "cfbbs-s3-smoke") process.exit(0);
  } catch (e) {
    console.log(
      JSON.stringify({
        idx,
        ok: false,
        region: conf.region,
        forcePathStyle: conf.forcePathStyle,
        endpoint: conf.endpoint,
        error: String(e).slice(0, 300),
      }),
    );
  }
}
process.exit(1);

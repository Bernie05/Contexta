import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";

export const dataDir = path.resolve(process.env.CONTEXTA_DATA_DIR ?? "./data");

/** Opens the local database. Same rule as db.ts: two processes must never open it together. */
export async function openPglite() {
  const lock = path.join(dataDir, "pg.lock");
  if (fs.existsSync(lock)) {
    try {
      process.kill(Number(fs.readFileSync(lock, "utf8")), 0);
      throw new Error("Stop the app first: it has the local database open.");
    } catch (err) {
      if (err.code !== "ESRCH") throw err;
    }
  }
  return PGlite.create(path.join(dataDir, "pg"), { extensions: { vector } });
}

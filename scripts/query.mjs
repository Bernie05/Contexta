// Runs one SQL statement and prints the rows: npm run db:query -- "SELECT id, name FROM folders"
// Uses DATABASE_URL when set, otherwise the local database (stop the app first).
import pg from "pg";
import { openPglite } from "./open-pglite.mjs";

const sql = process.argv[2];
if (!sql) throw new Error('Pass the SQL in quotes: npm run db:query -- "SELECT id, name FROM folders"');

if (process.env.DATABASE_URL) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    console.table((await client.query(sql)).rows);
  } finally {
    await client.end();
  }
} else {
  const lite = await openPglite();
  try {
    console.table((await lite.query(sql)).rows);
  } finally {
    await lite.close();
  }
}

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { env } from "../env";

declare global {
  // eslint-disable-next-line no-var
  var __hbePool: pg.Pool | undefined;
}

function createPool() {
  const url = env.databaseUrl;
  const needsSsl = /sslmode=require|neon\.tech/.test(url);
  return new pg.Pool({
    connectionString: url,
    max: Number(process.env.DB_POOL_MAX ?? 10),
    ssl: needsSsl ? { rejectUnauthorized: true } : undefined,
  });
}

export const pool = globalThis.__hbePool ?? (globalThis.__hbePool = createPool());
export const db = drizzle(pool, { schema });
export type DB = typeof db;
export { schema };

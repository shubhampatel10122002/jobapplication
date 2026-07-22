import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString =
  process.env.DATABASE_URL ?? "postgres://jobpilot:jobpilot@localhost:5432/jobpilot";

const client = postgres(connectionString);

export const db = drizzle(client, { schema });
export { schema };

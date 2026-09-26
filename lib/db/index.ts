import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";


const connectionString = process.env.DATABASE_URL;

export const db = connectionString ? drizzle(neon(connectionString), { schema }) : null;

export function getDb() {
  if (!db) {
    throw new Error(
      "DATABASE_URL environment variable is missing. Please set it in your .env or Vercel dashboard."
    );
  }
  return db;
}

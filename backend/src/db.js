import "dotenv/config";
import { Pool } from "pg";

function getConnectionString() {
  if (!process.env.SUPABASE_DB_URL && !process.env.DATABASE_URL && process.env.DATABBASE_URL) {
    console.warn("DATABBASE_URL is deprecated, rename it to DATABASE_URL");
  }
  const configured = process.env.SUPABASE_DB_URL
    || process.env.DATABASE_URL
    || process.env.DATABBASE_URL;
  if (!configured) {
    throw new Error("Set DATABASE_URL in backend/.env to your Supabase PostgreSQL connection string.");
  }

  const connectionString = configured.trim().replace(/^['"]|['"]$/g, "");
  try {
    new URL(connectionString);
    return connectionString;
  } catch {
    const schemeEnd = connectionString.indexOf("://");
    const separator = connectionString.lastIndexOf("@");
    const userInfoStart = schemeEnd + 3;
    const userInfo = connectionString.slice(userInfoStart, separator);
    const passwordSeparator = userInfo.indexOf(":");
    if (schemeEnd < 0 || separator < userInfoStart || passwordSeparator < 0 || connectionString.includes("%")) {
      throw new Error("DATABASE_URL must be a valid PostgreSQL connection string.");
    }

    const username = encodeURIComponent(userInfo.slice(0, passwordSeparator));
    const password = encodeURIComponent(userInfo.slice(passwordSeparator + 1));
    const normalized = `${connectionString.slice(0, userInfoStart)}${username}:${password}@${connectionString.slice(separator + 1)}`;
    try {
      new URL(normalized);
      return normalized;
    } catch {
      throw new Error("DATABASE_URL must be a valid PostgreSQL connection string.");
    }
  }
}

const db = new Pool({ connectionString: getConnectionString() });

export default db;

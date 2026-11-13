import "dotenv/config";
import { Pool } from "pg";

function getConnectionString() {
  const configured = process.env.DATABASE_URL;
  if (!configured || !String(configured).trim()) {
    throw new Error(
      "Set DATABASE_URL in backend/.env to your PostgreSQL connection string. "
      + "If the password contains special characters, percent-encode them in the URL "
      + "(for example # -> %23, @ -> %40, % -> %25)."
    );
  }

  const connectionString = String(configured).trim();
  try {
    new URL(connectionString);
  } catch {
    throw new Error(
      "DATABASE_URL must be a valid PostgreSQL connection URL. "
      + "If the password contains special characters, percent-encode them "
      + "(for example # -> %23, @ -> %40, % -> %25)."
    );
  }
  return connectionString;
}

function poolSslOption() {
  if (process.env.DATABASE_SSL === "false") {
    return false;
  }
  return { rejectUnauthorized: false };
}

const db = new Pool({
  connectionString: getConnectionString(),
  ssl: poolSslOption()
});

export default db;

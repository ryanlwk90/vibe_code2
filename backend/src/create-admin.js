import "dotenv/config";
import bcrypt from "bcryptjs";
import { emitKeypressEvents } from "node:readline";
import { createInterface } from "node:readline/promises";
import db from "./db.js";

async function ask(question) {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await prompt.question(question);
    return answer.trim();
  } finally {
    prompt.close();
  }
}

function askSecret(question) {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    if (!input.isTTY || typeof input.setRawMode !== "function") {
      reject(new Error("Run this command in an interactive terminal to enter the password securely."));
      return;
    }

    emitKeypressEvents(input);
    const previousRawMode = input.isRaw;
    let value = "";
    process.stdout.write(question);
    input.setRawMode(true);
    input.resume();

    const cleanup = () => {
      input.removeListener("keypress", onKeypress);
      input.setRawMode(previousRawMode);
      process.stdout.write("\n");
    };
    const onKeypress = (character, key) => {
      if (key?.ctrl && key.name === "c") {
        cleanup();
        reject(new Error("Password entry cancelled."));
      } else if (key?.name === "return" || key?.name === "enter") {
        cleanup();
        resolve(value);
      } else if (key?.name === "backspace") {
        value = value.slice(0, -1);
      } else if (character && !key?.ctrl && !key?.meta) {
        value += character;
      }
    };
    input.on("keypress", onKeypress);
  });
}

async function createAdmin() {
  const name = await ask("Administrator name: ");
  const email = (await ask("Administrator email: ")).toLowerCase();
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("A name and valid email address are required.");
  }

  const password = await askSecret("Password (at least 12 characters): ");
  const confirmation = await askSecret("Confirm password: ");
  if (password.length < 12 || Buffer.byteLength(password, "utf8") > 72) {
    throw new Error("Password must be 12 or more characters and no more than 72 UTF-8 bytes.");
  }
  if (password !== confirmation) throw new Error("Passwords do not match.");

  const passwordHash = await bcrypt.hash(password, 12);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("LOCK TABLE public.app_accounts IN EXCLUSIVE MODE");
    const { rows: admins } = await client.query(
      "SELECT account_id FROM public.app_accounts WHERE role = 'admin' LIMIT 1"
    );
    if (admins.length) throw new Error("An administrator already exists; create additional accounts after logging in.");
    await client.query(
      `INSERT INTO public.app_accounts (name, email, password_hash, role)
       VALUES ($1, $2, $3, 'admin')
       ON CONFLICT (email) DO UPDATE
       SET name = EXCLUDED.name, password_hash = EXCLUDED.password_hash, role = 'admin'`,
      [name, email, passwordHash]
    );
    await client.query("COMMIT");
    console.log("Initial administrator account created.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await db.end();
  }
}

createAdmin().catch((error) => {
  console.error("Could not create administrator:", error.message);
  process.exitCode = 1;
});

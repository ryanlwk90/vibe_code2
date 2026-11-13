import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import db from "./db.js";

const schemaPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../supabase/schema.sql"
);
const sampleProducts = [
  { pname: "Wireless Mouse", description: "Ergonomic 2.4 GHz wireless mouse", price: 24.99, qty: 45 },
  { pname: "Mechanical Keyboard", description: "Tenkeyless keyboard with tactile switches", price: 79.5, qty: 20 },
  { pname: "USB-C Hub", description: "7-in-1 hub with HDMI and card reader", price: 42, qty: 30 },
  { pname: "27-inch Monitor", description: "QHD IPS display with adjustable stand", price: 289.99, qty: 12 },
  { pname: "Laptop Stand", description: "Aluminum adjustable laptop stand", price: 39.95, qty: 18 }
];
const sampleUsers = [
  { uname: "Avery Morgan", email: "avery@example.com" },
  { uname: "Jordan Lee", email: "jordan@example.com" },
  { uname: "Sam Taylor", email: "sam@example.com" }
];
const sampleOrders = [
  { email: "avery@example.com", pname: "Wireless Mouse", order_date: "2026-10-28T10:30:00.000Z" },
  { email: "avery@example.com", pname: "USB-C Hub", order_date: "2026-10-29T14:15:00.000Z" },
  { email: "jordan@example.com", pname: "Mechanical Keyboard", order_date: "2026-11-02T09:00:00.000Z" },
  { email: "jordan@example.com", pname: "Laptop Stand", order_date: "2026-11-04T16:45:00.000Z" },
  { email: "sam@example.com", pname: "27-inch Monitor", order_date: "2026-11-06T11:20:00.000Z" }
];

async function seed() {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(fs.readFileSync(schemaPath, "utf8"));

    const productIds = new Map();
    for (const product of sampleProducts) {
      let result = await client.query(
        "SELECT pid FROM public.products WHERE pname = $1 LIMIT 1",
        [product.pname]
      );
      if (!result.rows.length) {
        result = await client.query(
          "INSERT INTO public.products (pname, description, price, qty) VALUES ($1, $2, $3, $4) RETURNING pid",
          [product.pname, product.description, product.price, product.qty]
        );
      }
      productIds.set(product.pname, result.rows[0].pid);
    }

    const userIds = new Map();
    const password = bcrypt.hashSync(randomBytes(32).toString("hex"), 10);
    for (const user of sampleUsers) {
      let result = await client.query(
        "SELECT uid FROM public.users WHERE email = $1 LIMIT 1",
        [user.email]
      );
      if (!result.rows.length) {
        result = await client.query(
          "INSERT INTO public.users (uname, email, password) VALUES ($1, $2, $3) RETURNING uid",
          [user.uname, user.email, password]
        );
      }
      userIds.set(user.email, result.rows[0].uid);
    }

    for (const order of sampleOrders) {
      const uid = userIds.get(order.email);
      const pid = productIds.get(order.pname);
      const existing = await client.query(
        "SELECT oid FROM public.orders WHERE uid = $1 AND pid = $2 AND order_date = $3 LIMIT 1",
        [uid, pid, order.order_date]
      );
      if (!existing.rows.length) {
        await client.query(
          "INSERT INTO public.orders (uid, pid, order_date) VALUES ($1, $2, $3)",
          [uid, pid, order.order_date]
        );
      }
    }

    const counts = await client.query(`
      SELECT
        (SELECT count(*)::int FROM public.products WHERE pname = ANY($1::text[])) AS products,
        (SELECT count(*)::int FROM public.users WHERE email = ANY($2::text[])) AS users,
        (SELECT count(*)::int FROM public.orders o
          JOIN public.users u ON u.uid = o.uid
          WHERE u.email = ANY($2::text[])) AS orders
    `, [
      sampleProducts.map(({ pname }) => pname),
      sampleUsers.map(({ email }) => email)
    ]);

    await client.query("COMMIT");
    console.log("Supabase tables and sample data are ready.");
    console.log(JSON.stringify(counts.rows[0]));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await db.end();
  }
}

seed().catch((error) => {
  console.error("Could not set up Supabase:", error.code || error.name, error.message);
  process.exitCode = 1;
});

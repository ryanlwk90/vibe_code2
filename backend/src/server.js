import "dotenv/config";
import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import db from "./db.js";
import { detectImageType, getImageSize } from "./image-utils.js";

const app = express();
app.set("trust proxy", 1);

function parseLoginRateLimitMax() {
  const raw = process.env.LOGIN_RATE_LIMIT_MAX;
  if (raw === undefined || raw === "") return 10;
  const parsed = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 10;
  return parsed;
}

const port = Number(process.env.PORT) || 3001;
const frontendOrigin = process.env.FRONTEND_ORIGIN || "http://localhost:5173";
const frontendDistPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../frontend/dist"
);
const productColumns = "pid, pname, description, price, qty";
const productSelect = `
  SELECT p.pid, p.pname, p.description, p.price, p.qty, pi.updated_at AS image_updated_at
  FROM public.products p
  LEFT JOIN public.product_images pi ON pi.pid = p.pid
`;
const allowedImageMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const imageBodyParser = express.raw({
  type: ["image/jpeg", "image/png", "image/webp"],
  limit: "200kb"
});
const userColumns = "uid, uname, email";
const accountColumns = "account_id, name, email, role, created_at";
const qualifiedAccountColumns = `a.${accountColumns.split(", ").join(", a.")}`;
const orderSelect = `
  SELECT o.oid, o.uid, u.uname, o.pid, p.pname, o.order_date
  FROM public.orders o
  JOIN public.users u ON u.uid = o.uid
  JOIN public.products p ON p.pid = o.pid
`;

const frontendIndexPath = path.join(frontendDistPath, "index.html");
const frontendBuilt = fs.existsSync(frontendIndexPath);
if (!frontendBuilt) {
  console.warn(
    "Frontend build not found (frontend/dist/index.html). The API will run without serving the UI. "
    + "Run `cd frontend && npm run build` when the front end is ready."
  );
}

app.use(cors({ origin: frontendOrigin, credentials: true }));
app.use(express.json({ limit: "1mb" }));

const sessionCookie = "store_session";
const sessionLifetimeSeconds = 7 * 24 * 60 * 60;
const sessionCookieOptions = [
  "Path=/api",
  "HttpOnly",
  "SameSite=Strict",
  `Max-Age=${sessionLifetimeSeconds}`,
  ...(process.env.NODE_ENV === "production" ? ["Secure"] : [])
].join("; ");
const expiredCookieOptions = [
  "Path=/api",
  "HttpOnly",
  "SameSite=Strict",
  "Max-Age=0",
  ...(process.env.NODE_ENV === "production" ? ["Secure"] : [])
].join("; ");
const dummyPasswordHash = bcrypt.hashSync(randomBytes(32).toString("hex"), 10);
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: parseLoginRateLimitMax(),
  skipSuccessfulRequests: true,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please try again later." }
});

function apiError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

async function query(sql, values = []) {
  return db.query(sql, values);
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function getSessionToken(req) {
  const cookie = req.headers.cookie?.split(";").find((part) => part.trim().startsWith(`${sessionCookie}=`));
  return cookie?.trim().slice(sessionCookie.length + 1) || null;
}

function publicAccount(account) {
  return {
    account_id: account.account_id,
    name: account.name,
    email: account.email,
    role: account.role,
    created_at: account.created_at
  };
}

function publicProduct(row) {
  return {
    pid: row.pid,
    pname: row.pname,
    description: row.description,
    price: row.price,
    qty: row.qty,
    image_updated_at: row.image_updated_at
      ? new Date(row.image_updated_at).toISOString()
      : null
  };
}

function normalizeContentType(header) {
  if (typeof header !== "string" || !header.trim()) {
    return null;
  }
  return header.split(";")[0].trim().toLowerCase();
}

function productImageETag(pid, updatedAt) {
  const stamp = updatedAt instanceof Date ? updatedAt.toISOString() : String(updatedAt);
  return `"${pid}-${stamp}"`;
}

const requireSession = asyncRoute(async (req, res, next) => {
  const token = getSessionToken(req);
  if (!token) throw apiError(401, "Please log in");
  const { rows } = await query(
    `SELECT ${qualifiedAccountColumns}, a.password_hash, s.token_hash
     FROM public.app_sessions s
     JOIN public.app_accounts a ON a.account_id = s.account_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashToken(token)]
  );
  if (!rows[0]) throw apiError(401, "Session expired. Please log in again");
  req.account = rows[0];
  next();
});

function requireAdmin(req, _res, next) {
  if (req.account?.role !== "admin") return next(apiError(403, "Administrator access required"));
  next();
}

function accountInput(body, partial = false) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw apiError(400, "A JSON object is required");
  }
  const result = {};
  if (!partial || body.name !== undefined) result.name = requiredText(body.name, "name");
  if (!partial || body.email !== undefined) {
    result.email = requiredText(body.email, "email").toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email)) {
      throw apiError(400, "email must be valid");
    }
  }
  if (!partial || body.role !== undefined) {
    if (body.role !== "reader" && body.role !== "admin") {
      throw apiError(400, "role must be reader or admin");
    }
    result.role = body.role;
  }
  if (!partial || body.password !== undefined) {
    if (
      typeof body.password !== "string"
      || body.password.length < 12
      || Buffer.byteLength(body.password, "utf8") > 72
    ) {
      throw apiError(400, "password must be 12 or more characters and no more than 72 UTF-8 bytes");
    }
    result.password_hash = bcrypt.hashSync(body.password, 12);
  }
  return result;
}

async function changeAccount(id, input, actorId) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const admins = await client.query(
      "SELECT account_id FROM public.app_accounts WHERE role = 'admin' ORDER BY account_id FOR UPDATE"
    );
    const currentResult = await client.query(
      `SELECT ${accountColumns} FROM public.app_accounts WHERE account_id = $1 FOR UPDATE`,
      [id]
    );
    const current = currentResult.rows[0];
    if (!current) throw apiError(404, "Account not found");
    const updated = { ...current, ...input };
    if (current.role === "admin" && updated.role !== "admin") {
      if (admins.rows.length <= 1) throw apiError(409, "At least one administrator must remain");
      if (Number(id) === Number(actorId)) {
        throw apiError(400, "You cannot change your own administrator role");
      }
    }
    const { rows } = await client.query(
      `UPDATE public.app_accounts
       SET name = $1, email = $2, role = $3, password_hash = COALESCE($4, password_hash)
       WHERE account_id = $5
       RETURNING ${accountColumns}`,
      [updated.name, updated.email, updated.role, input.password_hash ?? null, id]
    );
    if (input.password_hash || current.role !== updated.role) {
      await client.query("DELETE FROM public.app_sessions WHERE account_id = $1", [id]);
    }
    await client.query("COMMIT");
    return rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function removeAccount(id, actorId) {
  if (Number(id) === Number(actorId)) throw apiError(400, "You cannot delete your own account");
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const admins = await client.query(
      "SELECT account_id FROM public.app_accounts WHERE role = 'admin' ORDER BY account_id FOR UPDATE"
    );
    const currentResult = await client.query(
      "SELECT role FROM public.app_accounts WHERE account_id = $1 FOR UPDATE",
      [id]
    );
    const current = currentResult.rows[0];
    if (!current) throw apiError(404, "Account not found");
    if (current.role === "admin") {
      if (admins.rows.length <= 1) throw apiError(409, "At least one administrator must remain");
    }
    await client.query("DELETE FROM public.app_accounts WHERE account_id = $1", [id]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function findRow(sql, values, resource) {
  const { rows } = await query(sql, values);
  if (!rows[0]) throw apiError(404, `${resource} not found`);
  return rows[0];
}

function positiveId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw apiError(400, "ID must be a positive integer");
  }
  return id;
}

function requiredText(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw apiError(400, `${field} is required`);
  }
  return value.trim();
}

function productInput(body, partial = false) {
  const result = {};
  if (!partial || body.pname !== undefined) result.pname = requiredText(body.pname, "pname");
  if (!partial || body.description !== undefined) {
    if (typeof body.description !== "string" && body.description !== undefined) {
      throw apiError(400, "description must be a string");
    }
    result.description = body.description?.trim() ?? "";
  }
  if (!partial || body.price !== undefined) {
    result.price = Number(body.price);
    if (!Number.isFinite(result.price) || result.price < 0) {
      throw apiError(400, "price must be a non-negative number");
    }
  }
  if (!partial || body.qty !== undefined) {
    result.qty = Number(body.qty);
    if (!Number.isSafeInteger(result.qty) || result.qty < 0) {
      throw apiError(400, "qty must be a non-negative integer");
    }
  }
  return result;
}

function userInput(body, partial = false) {
  const result = {};
  if (!partial || body.uname !== undefined) result.uname = requiredText(body.uname, "uname");
  if (!partial || body.email !== undefined) {
    result.email = requiredText(body.email, "email").toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email)) {
      throw apiError(400, "email must be valid");
    }
  }
  if (!partial || body.password !== undefined) {
    if (typeof body.password !== "string" || !body.password) {
      throw apiError(400, "password is required");
    }
    result.password = bcrypt.hashSync(body.password, 10);
  }
  return result;
}

function orderInput(body, partial = false) {
  const result = {};
  for (const field of ["uid", "pid"]) {
    if (!partial || body[field] !== undefined) result[field] = positiveId(body[field]);
  }
  if (body.order_date !== undefined) {
    const date = new Date(body.order_date);
    if (Number.isNaN(date.getTime())) throw apiError(400, "order_date must be a valid date");
    result.order_date = date.toISOString();
  }
  return result;
}

async function updateProduct(id, body) {
  const input = productInput(body, true);
  if (!Object.keys(input).length) throw apiError(400, "Provide at least one product field to update");
  const current = await findRow(
    `${productSelect} WHERE p.pid = $1`,
    [id],
    "Product"
  );
  const updated = { ...current, ...input };
  const { rows } = await query(
    `UPDATE public.products SET pname = $1, description = $2, price = $3, qty = $4
     WHERE pid = $5 RETURNING ${productColumns}`,
    [updated.pname, updated.description, updated.price, updated.qty, id]
  );
  return rows[0];
}

async function updateUser(id, body) {
  const input = userInput(body, true);
  if (!Object.keys(input).length) throw apiError(400, "Provide at least one user field to update");
  const current = await findRow(
    "SELECT uid, uname, email FROM public.users WHERE uid = $1",
    [id],
    "User"
  );
  const updated = { ...current, ...input };
  const { rows } = await query(
    "UPDATE public.users SET uname = $1, email = $2, password = COALESCE($3, password) WHERE uid = $4 RETURNING uid, uname, email",
    [updated.uname, updated.email, input.password ?? null, id]
  );
  return rows[0];
}

app.get("/api/health", asyncRoute(async (_req, res) => {
  await query("SELECT 1");
  res.json({ status: "ok", database: "supabase" });
}));

app.post("/api/auth/login", loginLimiter, asyncRoute(async (req, res) => {
  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const { rows } = email && password
    ? await query(
      `SELECT ${qualifiedAccountColumns}, a.password_hash
       FROM public.app_accounts a WHERE a.email = $1`,
      [email]
    )
    : { rows: [] };
  const account = rows[0];
  const passwordMatches = await bcrypt.compare(password || "invalid-password", account?.password_hash || dummyPasswordHash);
  if (!account || !passwordMatches) throw apiError(401, "Invalid email or password");

  const token = randomBytes(32).toString("base64url");
  await query("DELETE FROM public.app_sessions WHERE expires_at <= now()");
  await query(
    "INSERT INTO public.app_sessions (token_hash, account_id, expires_at) VALUES ($1, $2, now() + interval '7 days')",
    [hashToken(token), account.account_id]
  );
  res.setHeader("Set-Cookie", `${sessionCookie}=${token}; ${sessionCookieOptions}`);
  res.json({ account: publicAccount(account) });
}));

app.get("/api/auth/me", requireSession, (req, res) => {
  res.json({ account: publicAccount(req.account) });
});

app.post("/api/auth/logout", asyncRoute(async (req, res) => {
  const token = getSessionToken(req);
  if (token) await query("DELETE FROM public.app_sessions WHERE token_hash = $1", [hashToken(token)]);
  res.setHeader("Set-Cookie", `${sessionCookie}=; ${expiredCookieOptions}`);
  res.status(204).end();
}));

app.use("/api", requireSession);
app.use("/api", (req, res, next) => {
  if (req.method === "GET") return next();
  requireAdmin(req, res, next);
});

app.get("/api/admin/accounts", requireAdmin, asyncRoute(async (_req, res) => {
  const { rows } = await query(`SELECT ${accountColumns} FROM public.app_accounts ORDER BY account_id DESC`);
  res.json(rows);
}));

app.post("/api/admin/accounts", asyncRoute(async (req, res) => {
  const account = accountInput(req.body);
  const { rows } = await query(
    `INSERT INTO public.app_accounts (name, email, role, password_hash)
     VALUES ($1, $2, $3, $4) RETURNING ${accountColumns}`,
    [account.name, account.email, account.role, account.password_hash]
  );
  res.status(201).json(rows[0]);
}));

app.put("/api/admin/accounts/:id", asyncRoute(async (req, res) => {
  const input = accountInput(req.body, true);
  if (!Object.keys(input).length) throw apiError(400, "Provide at least one account field to update");
  res.json(await changeAccount(positiveId(req.params.id), input, req.account.account_id));
}));

app.delete("/api/admin/accounts/:id", asyncRoute(async (req, res) => {
  await removeAccount(positiveId(req.params.id), req.account.account_id);
  res.status(204).end();
}));

app.get("/api/get_products", asyncRoute(async (_req, res) => {
  const { rows } = await query(`${productSelect} ORDER BY p.pid DESC`);
  res.json(rows.map(publicProduct));
}));
app.get("/api/get_product/:id", asyncRoute(async (req, res) => {
  const row = await findRow(
    `${productSelect} WHERE p.pid = $1`,
    [positiveId(req.params.id)],
    "Product"
  );
  res.json(publicProduct(row));
}));

app.put(
  "/api/products/:pid/image",
  imageBodyParser,
  asyncRoute(async (req, res) => {
    const pid = positiveId(req.params.pid);
    const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);

    const contentType = normalizeContentType(req.headers["content-type"]);
    if (!contentType || !allowedImageMimeTypes.has(contentType)) {
      throw apiError(415, "Content-Type must be image/jpeg, image/png, or image/webp");
    }

    if (!body.length) {
      throw apiError(400, "Request body is empty");
    }

    const { rowCount: productExists } = await query("SELECT 1 FROM public.products WHERE pid = $1", [pid]);
    if (!productExists) {
      throw apiError(404, "Product not found");
    }

    const detected = detectImageType(body);
    if (!detected || detected !== contentType) {
      throw apiError(415, "Image bytes do not match the declared Content-Type");
    }

    const size = getImageSize(body, contentType);
    if (!size || size.width !== 200 || size.height !== 200) {
      throw apiError(400, "Image must be exactly 200 x 200 pixels");
    }

    const { rows } = await query(
      `INSERT INTO public.product_images (pid, mime, bytes, data, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (pid) DO UPDATE
       SET mime = EXCLUDED.mime, bytes = EXCLUDED.bytes, data = EXCLUDED.data, updated_at = now()
       RETURNING pid, mime, bytes, updated_at`,
      [pid, contentType, body.length, body]
    );
    const saved = rows[0];
    res.json({
      pid: saved.pid,
      mime: saved.mime,
      bytes: saved.bytes,
      updated_at: new Date(saved.updated_at).toISOString()
    });
  })
);

app.get("/api/products/:pid/image", asyncRoute(async (req, res) => {
  const pid = positiveId(req.params.pid);
  const { rows } = await query(
    "SELECT mime, bytes, data, updated_at FROM public.product_images WHERE pid = $1",
    [pid]
  );
  const image = rows[0];
  if (!image) {
    throw apiError(404, "Product image not found");
  }

  const etag = productImageETag(pid, image.updated_at);
  res.setHeader("ETag", etag);
  res.setHeader("Cache-Control", "private, max-age=86400");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Type", image.mime);
  res.setHeader("Content-Length", String(image.bytes));

  const ifNoneMatch = req.headers["if-none-match"];
  if (ifNoneMatch === etag) {
    return res.status(304).end();
  }

  res.send(image.data);
}));

app.delete("/api/products/:pid/image", asyncRoute(async (req, res) => {
  const pid = positiveId(req.params.pid);
  const { rowCount } = await query("DELETE FROM public.product_images WHERE pid = $1", [pid]);
  if (!rowCount) {
    throw apiError(404, "Product image not found");
  }
  res.status(204).end();
}));
app.post("/api/add_product", asyncRoute(async (req, res) => {
  const product = productInput(req.body);
  const { rows } = await query(
    `INSERT INTO public.products (pname, description, price, qty) VALUES ($1, $2, $3, $4)
     RETURNING ${productColumns}`,
    [product.pname, product.description, product.price, product.qty]
  );
  res.status(201).json(rows[0]);
}));
app.delete("/api/delete_product/:id", asyncRoute(async (req, res) => {
  const { rowCount } = await query(
    "DELETE FROM public.products WHERE pid = $1",
    [positiveId(req.params.id)]
  );
  if (!rowCount) throw apiError(404, "Product not found");
  res.status(204).end();
}));
app.put("/api/update_product/:id", asyncRoute(async (req, res) => {
  res.json(await updateProduct(positiveId(req.params.id), req.body));
}));

app.get("/api/get_users", asyncRoute(async (_req, res) => {
  const { rows } = await query(`SELECT ${userColumns} FROM public.users ORDER BY uid DESC`);
  res.json(rows);
}));
app.get("/api/get_user/:id", asyncRoute(async (req, res) => {
  const row = await findRow(
    `SELECT ${userColumns} FROM public.users WHERE uid = $1`,
    [positiveId(req.params.id)],
    "User"
  );
  res.json(row);
}));
app.post("/api/add_user", asyncRoute(async (req, res) => {
  const user = userInput(req.body);
  const { rows } = await query(
    "INSERT INTO public.users (uname, email, password) VALUES ($1, $2, $3) RETURNING uid, uname, email",
    [user.uname, user.email, user.password]
  );
  res.status(201).json(rows[0]);
}));
app.delete("/api/delete_user/:id", asyncRoute(async (req, res) => {
  const { rowCount } = await query(
    "DELETE FROM public.users WHERE uid = $1",
    [positiveId(req.params.id)]
  );
  if (!rowCount) throw apiError(404, "User not found");
  res.status(204).end();
}));
app.put("/api/update_user/:id", asyncRoute(async (req, res) => {
  res.json(await updateUser(positiveId(req.params.id), req.body));
}));

app.put("/api/update/:id", asyncRoute(async (req, res) => {
  const id = positiveId(req.params.id);
  if (req.body.entity === "product") return res.json(await updateProduct(id, req.body));
  if (req.body.entity === "user") return res.json(await updateUser(id, req.body));
  res.status(400).json({ error: 'Set "entity" to "product" or "user" to select the record type' });
}));

app.get("/api/get_orders", asyncRoute(async (req, res) => {
  const conditions = [];
  const values = [];
  if (req.query.uid !== undefined) {
    values.push(positiveId(req.query.uid));
    conditions.push(`o.uid = $${values.length}`);
  }
  if (req.query.pid !== undefined) {
    values.push(positiveId(req.query.pid));
    conditions.push(`o.pid = $${values.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows } = await query(`${orderSelect} ${where} ORDER BY o.oid DESC`, values);
  res.json(rows);
}));
app.get("/api/get_orders/uid/:uid", asyncRoute(async (req, res) => {
  const { rows } = await query(
    `${orderSelect} WHERE o.uid = $1 ORDER BY o.oid DESC`,
    [positiveId(req.params.uid)]
  );
  res.json(rows);
}));
app.get("/api/get_orders/pid/:pid", asyncRoute(async (req, res) => {
  const { rows } = await query(
    `${orderSelect} WHERE o.pid = $1 ORDER BY o.oid DESC`,
    [positiveId(req.params.pid)]
  );
  res.json(rows);
}));
app.get("/api/get_order/:id", asyncRoute(async (req, res) => {
  const row = await findRow(
    `${orderSelect} WHERE o.oid = $1`,
    [positiveId(req.params.id)],
    "Order"
  );
  res.json(row);
}));
app.post("/api/add_order", asyncRoute(async (req, res) => {
  const order = orderInput(req.body);
  const values = [order.uid, order.pid];
  const dateSql = order.order_date ? ", order_date" : "";
  const dateValue = order.order_date ? ", $3" : "";
  if (order.order_date) values.push(order.order_date);
  const { rows } = await query(
    `INSERT INTO public.orders (uid, pid${dateSql}) VALUES ($1, $2${dateValue}) RETURNING oid`,
    values
  );
  const created = await findRow(
    `${orderSelect} WHERE o.oid = $1`,
    [rows[0].oid],
    "Order"
  );
  res.status(201).json(created);
}));
app.delete("/api/delete_order/:id", asyncRoute(async (req, res) => {
  const { rowCount } = await query(
    "DELETE FROM public.orders WHERE oid = $1",
    [positiveId(req.params.id)]
  );
  if (!rowCount) throw apiError(404, "Order not found");
  res.status(204).end();
}));
app.put("/api/update_order/:id", asyncRoute(async (req, res) => {
  const id = positiveId(req.params.id);
  const input = orderInput(req.body, true);
  if (!Object.keys(input).length) throw apiError(400, "Provide at least one order field to update");
  const current = await findRow(
    "SELECT oid, uid, pid, order_date FROM public.orders WHERE oid = $1",
    [id],
    "Order"
  );
  const updated = { ...current, ...input };
  await query(
    "UPDATE public.orders SET uid = $1, pid = $2, order_date = $3 WHERE oid = $4",
    [updated.uid, updated.pid, updated.order_date, id]
  );
  const row = await findRow(`${orderSelect} WHERE o.oid = $1`, [id], "Order");
  res.json(row);
}));

app.use("/api", (_req, res) => res.status(404).json({ error: "API endpoint not found" }));
if (frontendBuilt) {
  app.use(express.static(frontendDistPath));
  app.get("*", (_req, res) => res.sendFile(frontendIndexPath));
} else {
  app.get("/", (_req, res) => {
    res.json({ message: "CRUD API is running. Build the Vue front end to serve the UI from this server." });
  });
}
app.use((error, _req, res, _next) => {
  if (error.type === "entity.too.large") {
    return res.status(413).json({ error: "Image must be 200 KB or smaller" });
  }
  if (error.code === "23505") {
    return res.status(409).json({ error: "A record with this email already exists" });
  }
  if (error.code === "23503") {
    return res.status(409).json({ error: "The referenced user or product does not exist, or is still used by an order" });
  }
  if (error.code === "23514" || error.code === "23502") {
    return res.status(400).json({ error: "The submitted data does not meet the database constraints" });
  }
  if (error instanceof SyntaxError && "body" in error) {
    return res.status(400).json({ error: "Request body must be valid JSON" });
  }
  const status = error.status || 500;
  if (status >= 500) console.error(error);
  res.status(status).json({ error: status >= 500 ? "Internal server error" : error.message });
});

app.listen(port, () => {
  console.log(`CRUD app listening at http://localhost:${port}`);
});

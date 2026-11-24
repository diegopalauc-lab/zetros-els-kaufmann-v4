import items from "./items.json" with { type: "json" };
import vehicles from "./vehicles.json" with { type: "json" };

const owners = ["Pablo", "Miguel", "Carlos", "David", "Márquez", "Fausto", "Larisa", "Silvestre", "Adolfo", "Vicente"];
const ids = new Set(items.map(({id}) => id));
const vins = new Set(vehicles);
const references = new Set(items.flatMap(({photos, categoryPhotos = []}) => [...photos, ...categoryPhotos]).map((name) => "/reference/" + name));
const publicPaths = new Set(["/", "/app.js", "/style.css", "/logo-els.png", "/logo-kaufmann.png"]);
const sessionSeconds = 7 * 24 * 3600;
const photoLimit = 750_000;
const encoder = new TextEncoder();
const security = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

const schema = [
  "CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, author TEXT NOT NULL, generation TEXT NOT NULL, expires INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires)",
  "CREATE TABLE IF NOT EXISTS states (item TEXT PRIMARY KEY, owner TEXT NOT NULL DEFAULT '', solved INTEGER NOT NULL DEFAULT 0)",
  "CREATE TABLE IF NOT EXISTS activity (id INTEGER PRIMARY KEY, item TEXT NOT NULL, author TEXT NOT NULL, time TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', mime TEXT, photo TEXT)",
  "CREATE INDEX IF NOT EXISTS activity_item ON activity(item, id)",
];

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(data, status = 200, headers = {}) {
  return Response.json(data, {status, headers: {...security, ...headers}});
}

function base64(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decode(value) {
  return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (char) => char.charCodeAt(0));
}

function cookie(value, maxAge = sessionSeconds) {
  return `zetros=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

function now() {
  return Math.floor(Date.now() / 1000);
}

function signingKey(secret) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), {name: "HMAC", hash: "SHA-256"}, false, ["sign", "verify"]);
}

async function digest(value) {
  return base64(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

async function session(request, env) {
  const match = /(?:^|;\s*)zetros=([\w-]{43})(?=;|$)/.exec(request.headers.get("Cookie") || "");
  if (!match) return null;
  const token = await digest(match[1]);
  return env.DB.prepare("SELECT token, author FROM sessions WHERE token = ? AND generation = ? AND expires > ?")
    .bind(token, await digest(env.ZETROS_ACCESS_KEY), now()).first();
}

async function readBody(request, limit) {
  if (Number(request.headers.get("Content-Length")) > limit) {
    throw new RequestError(413, "El archivo o mensaje supera el tamaño permitido.");
  }
  if (!request.body) throw new RequestError(400, "El archivo o mensaje está vacío.");
  const reader = request.body.getReader();
  const buffer = new Uint8Array(limit);
  let size = 0;
  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    if (size + value.length > limit) {
      await reader.cancel();
      throw new RequestError(413, "El archivo o mensaje supera el tamaño permitido.");
    }
    buffer.set(value, size);
    size += value.length;
  }
  return buffer.subarray(0, size);
}

async function readJSON(request) {
  if (request.headers.get("Content-Type")?.split(";")[0] !== "application/json") {
    throw new RequestError(415, "Formato de solicitud inválido.");
  }
  const bytes = await readBody(request, 24_576);
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
  } catch {}
  throw new RequestError(400, "Solicitud inválida.");
}

async function join(request, env) {
  const {name, key: invite} = await readJSON(request);
  if (typeof invite !== "string" || !/^[a-fA-F0-9]{64}$/.test(invite)) {
    throw new RequestError(403, "Abre el enlace compartido por el equipo.");
  }
  const check = encoder.encode("zetros:access");
  const signature = await crypto.subtle.sign("HMAC", await signingKey(invite), check);
  if (!await crypto.subtle.verify("HMAC", await signingKey(env.ZETROS_ACCESS_KEY), signature, check)) {
    throw new RequestError(403, "El enlace ya no es válido. Pide el enlace vigente al equipo.");
  }
  const author = typeof name === "string" ? name.trim().replace(/\s+/gu, " ") : "";
  if (!author || author.length > 80 || /\p{C}/u.test(author)) {
    throw new RequestError(400, "Ingresa un nombre de hasta 80 caracteres.");
  }
  const token = base64(crypto.getRandomValues(new Uint8Array(32)));
  const generation = await digest(env.ZETROS_ACCESS_KEY);
  const started = now();
  await env.DB.batch([
    ...schema.map((statement) => env.DB.prepare(statement)),
    env.DB.prepare("DELETE FROM sessions WHERE expires <= ?").bind(started),
    env.DB.prepare("INSERT INTO sessions VALUES (?, ?, ?, ?)").bind(await digest(token), author, generation, started + sessionSeconds),
  ]);
  return json({user: author}, 200, {"Set-Cookie": cookie(token)});
}

async function updateState(request, db, item, author) {
  const data = await readJSON(request);
  let field, value, message;
  if (Object.keys(data).length === 1 && ["", ...owners].includes(data.owner)) {
    field = "owner";
    value = data.owner;
    message = "Responsable: " + (value || "Sin asignar");
  } else if (Object.keys(data).length === 1 && typeof data.solved === "boolean") {
    field = "solved";
    value = Number(data.solved);
    message = value ? "Marcó como solucionado" : "Reabrió el punto";
  } else {
    throw new RequestError(400, "Estado o responsable inválido.");
  }

  // A D1 batch is transactional. Record the change before updating the single requested field.
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO states(item) VALUES (?)").bind(item),
    db.prepare(`INSERT INTO activity(item, author, time, kind, body)
      SELECT item, ?, ?, 'change', ? FROM states WHERE item = ? AND ${field} <> ?`)
      .bind(author, new Date().toISOString(), message, item, value),
    db.prepare(`UPDATE states SET ${field} = ? WHERE item = ? AND ${field} <> ?`).bind(value, item, value),
  ]);
  return json({ok: true});
}

async function comment(request, db, item, author) {
  const data = await readJSON(request);
  const body = typeof data.body === "string" ? data.body.trim() : "";
  if (!body || body.length > 2000) {
    throw new RequestError(400, "El comentario debe tener entre 1 y 2.000 caracteres.");
  }
  await db.prepare("INSERT INTO activity(item, author, time, kind, body) VALUES (?, ?, ?, 'comment', ?)")
    .bind(item, author, new Date().toISOString(), body).run();
  return json({ok: true}, 201);
}

async function savePhoto(request, db, item, author) {
  const bytes = await readBody(request, photoLimit);
  if (bytes.length < 5 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255 ||
      bytes.at(-2) !== 255 || bytes.at(-1) !== 217) {
    throw new RequestError(415, "La foto debe estar en formato JPG.");
  }
  const row = await db.prepare(`INSERT INTO activity(item, author, time, kind, mime, photo)
    VALUES (?, ?, ?, 'photo', 'image/jpeg', ?) RETURNING id`)
    .bind(item, author, new Date().toISOString(), base64(bytes)).first();
  return json({id: row.id}, 201);
}

async function asset(request, env) {
  const source = await env.ASSETS.fetch(request);
  const headers = new Headers(source.headers);
  for (const [name, value] of Object.entries(security)) headers.set(name, value);
  return new Response(source.body, {status: source.status, headers});
}

function requireVin(vin) {
  if (!vins.has(vin)) throw new RequestError(400, "Selecciona un VIN válido.");
  return vin;
}

async function loadBoard(db, vin, author) {
  if (vin !== null) requireVin(vin);
  const total = db.prepare(`SELECT COUNT(*) AS solved FROM states
    WHERE solved = 1 AND substr(item, 18, 1) = ':'
      AND substr(item, 1, 17) IN (SELECT value FROM json_each(?))
      AND substr(item, 19) IN (SELECT value FROM json_each(?))`)
    .bind(JSON.stringify(vehicles), JSON.stringify([...ids]));
  let individual = [];
  let fleet;
  if (vin) {
    // Read both indicators from the same database snapshot.
    const [selected, overall] = await db.batch([
      db.prepare("SELECT substr(item, 19) AS item, owner, solved FROM states WHERE item >= ? AND item < ?")
        .bind(`${vin}:`, `${vin};`),
      total,
    ]);
    individual = selected.results;
    fleet = overall.results[0];
  } else {
    fleet = await total.first();
  }
  const states = Object.fromEntries(individual.filter(({item}) => ids.has(item)).map((row) => [
    row.item,
    {...row, owner: owners.includes(row.owner) ? row.owner : ""},
  ]));
  return json({items, states, owners, vehicles, vin, fleetSolved: fleet.solved, user: author});
}

async function route(request, env) {
  const {pathname, searchParams} = new URL(request.url);
  const vin = searchParams.get("vin");
  const {method} = request;

  if (method === "GET" && publicPaths.has(pathname)) return asset(request, env);
  if (method === "POST" && request.headers.get("X-Zetros-Request") !== "1") {
    throw new RequestError(403, "Solicitud bloqueada.");
  }
  const secret = env.ZETROS_ACCESS_KEY;
  if (!secret || !/^[a-fA-F0-9]{64}$/.test(secret)) {
    throw new RequestError(503, "El acceso al tablero aún no está configurado.");
  }

  if (method === "POST" && pathname === "/api/join") return join(request, env);
  const visitor = await session(request, env);
  if (!visitor) throw new RequestError(401, "Abre el enlace compartido por el equipo.");
  const {author, token} = visitor;
  const db = env.DB;

  if (method === "POST" && pathname === "/api/logout") {
    await db.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
    return json({ok: true}, 200, {"Set-Cookie": cookie("", 0)});
  }
  if (method === "GET" && pathname === "/api/board") {
    return loadBoard(db, vin, author);
  }
  if (method === "GET" && references.has(pathname)) return asset(request, env);

  const photo = /^\/photos\/([0-9]{1,15})$/.exec(pathname);
  if (method === "GET" && photo) {
    const vehicle = requireVin(vin);
    const row = await db.prepare("SELECT photo, mime FROM activity WHERE id = ? AND kind = 'photo' AND item >= ? AND item < ?")
      .bind(Number(photo[1]), `${vehicle}:`, `${vehicle};`).first();
    if (row) return new Response(decode(row.photo), {headers: {...security, "Content-Type": row.mime}});
  }
  const endpoint = /^\/api\/([\d.]+)\/(activity|state|comment|photo)$/.exec(pathname);
  if (endpoint && ids.has(endpoint[1])) {
    const [, id, action] = endpoint;
    const item = `${requireVin(vin)}:${id}`;
    if (method === "GET" && action === "activity") {
      const {results} = await db.prepare("SELECT id, author, time, kind, body FROM activity WHERE item = ? ORDER BY id DESC")
        .bind(item).all();
      return json(results);
    }
    if (method === "POST") {
      if (action === "state") return updateState(request, db, item, author);
      if (action === "comment") return comment(request, db, item, author);
      if (action === "photo") return savePhoto(request, db, item, author);
    }
  }
  throw new RequestError(404, "No encontramos lo solicitado.");
}

export default {
  async fetch(request, env) {
    try {
      return await route(request, env);
    } catch (error) {
      if (error instanceof RequestError) return json({error: error.message}, error.status);
      console.error(error);
      return json({error: "No pudimos completar la solicitud. Intenta nuevamente."}, 500);
    }
  },
};

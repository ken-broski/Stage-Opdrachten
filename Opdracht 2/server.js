const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "activiteiten.sqlite");
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const sessions = new Map();

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(DB_FILE);
db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE
  );
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY,
    category_id INTEGER NOT NULL REFERENCES categories(id),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    date_time TEXT NOT NULL,
    location TEXT NOT NULL,
    image_url TEXT NOT NULL DEFAULT '',
    capacity INTEGER NOT NULL CHECK (capacity > 0),
    status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'cancelled')),
    created_at TEXT NOT NULL,
    created_by_employee_id INTEGER REFERENCES employees(id)
  );
  CREATE TABLE IF NOT EXISTS registrations (
    id INTEGER PRIMARY KEY,
    event_id INTEGER NOT NULL REFERENCES events(id),
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS one_active_registration_per_email
    ON registrations(event_id, lower(email)) WHERE status = 'active';
`);
const eventColumns = db.prepare("PRAGMA table_info(events)").all();
if (!eventColumns.some((column) => column.name === "created_by_employee_id")) {
  db.exec("ALTER TABLE events ADD COLUMN created_by_employee_id INTEGER REFERENCES employees(id)");
}
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function hashPassword(password, salt = crypto.randomBytes(16)) {
  return `${salt.toString("hex")}:${crypto.scryptSync(password, salt, 64).toString("hex")}`;
}

function passwordMatches(password, stored) {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), 64);
  const expected = Buffer.from(hashHex, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function initializeData() {
  const adminEmail = process.env.ADMIN_EMAIL?.trim();
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (adminEmail && adminPassword) {
    if (adminPassword.length < 12) {
      throw new Error("ADMIN_PASSWORD moet minimaal 12 tekens bevatten.");
    }
    if (!db.prepare("SELECT id FROM employees LIMIT 1").get()) {
      db.prepare("INSERT INTO employees (email, password_hash, created_at) VALUES (?, ?, ?)")
        .run(adminEmail, hashPassword(adminPassword), new Date().toISOString());
      console.log(`Beheerdersaccount aangemaakt voor ${adminEmail}.`);
    }
  }

  const updateSampleEvent = db.prepare(
    "UPDATE events SET title = ?, description = ?, location = ? WHERE title = ?"
  );
  updateSampleEvent.run(
    "Website maken met alleen HTML",
    "Leer stap voor stap hoe je met alleen HTML een eenvoudige website maakt. Je bouwt een eigen pagina met koppen, tekst, links en afbeeldingen. Neem je laptop mee; ervaring met websites maken is niet nodig.",
    "Computerlokaal",
    "Maak je eigen vaas van klei"
  );
  updateSampleEvent.run(
    "Opstand van het Ottomaanse Rijk",
    "In deze lezing bespreken we opstanden binnen het Ottomaanse Rijk en de historische omstandigheden waarin ze ontstonden. We staan stil bij de achtergronden en gevolgen en er is ruimte om vragen te stellen.",
    "Grote zaal",
    "Kleine stappen naar een groenere tuin"
  );
  updateSampleEvent.run(
    "Samen koken: baklava maken",
    "We maken samen baklava en bekijken stap voor stap hoe dit bekende laagjesgebak wordt bereid. Daarna is er tijd om samen te proeven en gezellig bij te praten. Meld eventuele allergieën vooraf bij het buurthuis.",
    "Keuken van het buurthuis",
    "Samen koken: smaken van thuis"
  );

  if (db.prepare("SELECT id FROM categories LIMIT 1").get()) return;
  const insertCategory = db.prepare("INSERT INTO categories (name) VALUES (?)");
  const ids = {
    workshop: Number(insertCategory.run("Workshops").lastInsertRowid),
    lezing: Number(insertCategory.run("Lezingen").lastInsertRowid),
    buurt: Number(insertCategory.run("Samen in de buurt").lastInsertRowid)
  };
  if (db.prepare("SELECT id FROM events LIMIT 1").get()) return;

  const samples = [
    [ids.workshop, "Website maken met alleen HTML", "Leer stap voor stap hoe je met alleen HTML een eenvoudige website maakt. Je bouwt een eigen pagina met koppen, tekst, links en afbeeldingen. Neem je laptop mee; ervaring met websites maken is niet nodig.", 7, "Computerlokaal", 12, "published"],
    [ids.lezing, "Opstand van het Ottomaanse Rijk", "In deze lezing bespreken we opstanden binnen het Ottomaanse Rijk en de historische omstandigheden waarin ze ontstonden. We staan stil bij de achtergronden en gevolgen en er is ruimte om vragen te stellen.", 14, "Grote zaal", 24, "published"],
    [ids.buurt, "Samen koken: baklava maken", "We maken samen baklava en bekijken stap voor stap hoe dit bekende laagjesgebak wordt bereid. Daarna is er tijd om samen te proeven en gezellig bij te praten. Meld eventuele allergieën vooraf bij het buurthuis.", 21, "Keuken van het buurthuis", 16, "published"]
  ];
  const insertEvent = db.prepare(`INSERT INTO events
    (category_id, title, description, date_time, location, image_url, capacity, status, created_at, created_by_employee_id)
    VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, ?)`);
  const employeeId = db.prepare("SELECT id FROM employees ORDER BY id LIMIT 1").get()?.id ?? null;
  const now = new Date();
  for (const [categoryId, title, description, days, location, capacity, status] of samples) {
    const date = new Date(now);
    date.setDate(date.getDate() + days);
    date.setHours(18, 30, 0, 0);
    insertEvent.run(categoryId, title, description, date.toISOString(), location, capacity, status, now.toISOString(), employeeId);
  }
}

initializeData();
if (!db.prepare("SELECT id FROM employees LIMIT 1").get()) {
  console.warn("Geen medewerker ingesteld. Stel ADMIN_EMAIL en ADMIN_PASSWORD in en herstart de server.");
}

const publicFiles = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/beheer", ["beheer.html", "text/html; charset=utf-8"]],
  ["/beheer.html", ["beheer.html", "text/html; charset=utf-8"]],
  ["/style.css", ["style.css", "text/css; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/admin.js", ["admin.js", "text/javascript; charset=utf-8"]],
  ["/placeholder.svg", ["placeholder.svg", "image/svg+xml"]]
]);

function setSecurityHeaders(response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' https: data:; style-src 'self'; font-src 'self'; script-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'");
}

function sendJson(response, status, data) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(data));
}

function parseCookies(request) {
  const result = new Map();
  for (const pair of (request.headers.cookie || "").split(";")) {
    const separator = pair.indexOf("=");
    if (separator > 0) result.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
  }
  return result;
}

function getEmployee(request) {
  const token = parseCookies(request).get("brink_session");
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const key = crypto.createHash("sha256").update(token).digest("hex");
  const session = sessions.get(key);
  if (!session || session.expiresAt <= Date.now()) {
    sessions.delete(key);
    return null;
  }
  return db.prepare("SELECT id, email FROM employees WHERE id = ?").get(session.employeeId) || null;
}

function requireEmployee(request) {
  const employee = getEmployee(request);
  if (!employee) throw new HttpError(401, "Log in om deze beheerfunctie te gebruiken.");
  return employee;
}

function verifySameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return;
  const protocol = request.socket.encrypted ? "https" : "http";
  if (origin !== `${protocol}://${request.headers.host}`) {
    throw new HttpError(403, "Dit verzoek is niet toegestaan.");
  }
}

async function readJson(request) {
  if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "Verstuur de gegevens als JSON.");
  }
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > 32_768) throw new HttpError(413, "Het verzoek is te groot.");
  }
  try {
    const parsed = JSON.parse(body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new HttpError(400, "Verstuur een JSON-object met de gevraagde gegevens.");
    }
    return parsed;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "De verstuurde gegevens zijn geen geldige JSON.");
  }
}

function requiredText(value, label, maxLength) {
  if (typeof value !== "string" || !value.trim()) throw new HttpError(400, `Vul ${label} in.`);
  const text = value.trim();
  if (text.length > maxLength) throw new HttpError(400, `${label} mag maximaal ${maxLength} tekens bevatten.`);
  return text;
}

function validateEmail(value) {
  const email = requiredText(value, "een e-mailadres", 254);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, "Vul een geldig e-mailadres in.");
  }
  return email;
}

function validateActivity(body) {
  const title = requiredText(body.title, "een titel", 150);
  const description = requiredText(body.description, "een beschrijving", 5000);
  const location = requiredText(body.location, "een locatie", 200);
  const date = new Date(body.date_time);
  if (typeof body.date_time !== "string" || !Number.isFinite(date.getTime()) || date <= new Date()) {
    throw new HttpError(400, "Kies een geldige datum en tijd in de toekomst.");
  }
  const capacity = Number(body.capacity);
  if (!Number.isSafeInteger(capacity) || capacity <= 0) {
    throw new HttpError(400, "Het maximumaantal deelnemers moet een positief geheel getal zijn.");
  }
  const categoryId = Number(body.category_id);
  if (!Number.isSafeInteger(categoryId) || !db.prepare("SELECT id FROM categories WHERE id = ?").get(categoryId)) {
    throw new HttpError(400, "Kies een bestaande categorie.");
  }
  if (!["draft", "published", "cancelled"].includes(body.status)) {
    throw new HttpError(400, "Kies de status concept, gepubliceerd of geannuleerd.");
  }

  let imageUrl = "";
  if (body.image_url !== undefined && body.image_url !== null && String(body.image_url).trim()) {
    imageUrl = requiredText(String(body.image_url), "een geldige afbeeldingslink", 1000);
    if (!imageUrl.startsWith("/") || imageUrl.startsWith("//")) {
      let parsed;
      try {
        parsed = new URL(imageUrl);
      } catch {
        throw new HttpError(400, "Gebruik een afbeeldingslink die met https:// begint.");
      }
      if (parsed.protocol !== "https:") throw new HttpError(400, "Gebruik een afbeeldingslink die met https:// begint.");
    }
  }
  return { title, description, location, dateTime: date.toISOString(), capacity, categoryId, status: body.status, imageUrl };
}

function eventQuery(where, parameters = []) {
  return db.prepare(`SELECT e.*, c.name AS category_name,
    (SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.id AND r.status = 'active') AS active_registrations,
    e.capacity - (SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.id AND r.status = 'active') AS available_places
    FROM events e JOIN categories c ON c.id = e.category_id ${where}`).all(...parameters);
}

function exportCsv(response, event, registrations) {
  const quote = (value) => {
    let text = String(value);
    if (/^[\s]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const rows = [["Naam", "E-mailadres", "Status", "Aangemeld op"]];
  registrations.forEach((registration) => rows.push([
    registration.name,
    registration.email,
    registration.status === "active" ? "Actief" : "Geannuleerd",
    new Date(registration.created_at).toLocaleString("nl-NL")
  ]));
  const csv = `\uFEFF${rows.map((row) => row.map(quote).join(";")).join("\r\n")}`;
  const safeName = event.title.normalize("NFKD").replace(/[^\w-]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "activiteit";
  response.writeHead(200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${safeName}-deelnemers.csv"`,
    "Cache-Control": "no-store"
  });
  response.end(csv);
}

async function handleRequest(request, response) {
  setSecurityHeaders(response);
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const pathname = decodeURIComponent(url.pathname);

  if (request.method === "GET" && publicFiles.has(pathname)) {
    const [file, contentType] = publicFiles.get(pathname);
    response.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-cache" });
    response.end(fs.readFileSync(path.join(__dirname, file)));
    return;
  }

  if (request.method === "GET" && pathname === "/api/categories") {
    sendJson(response, 200, db.prepare("SELECT id, name FROM categories ORDER BY name").all());
    return;
  }
  if (request.method === "GET" && pathname === "/api/events") {
    const now = new Date().toISOString();
    sendJson(response, 200, eventQuery("WHERE e.status = 'published' AND e.date_time > ? ORDER BY e.date_time", [now]));
    return;
  }
  if (request.method === "GET" && pathname === "/api/admin/me") {
    const employee = getEmployee(request);
    sendJson(response, 200, { authenticated: Boolean(employee), email: employee?.email || null });
    return;
  }
  const eventMatch = pathname.match(/^\/api\/events\/(\d+)$/);
  if (request.method === "GET" && eventMatch) {
    const event = eventQuery("WHERE e.id = ? AND e.status != 'draft'", [Number(eventMatch[1])])[0];
    if (!event) throw new HttpError(404, "Deze activiteit is niet gevonden.");
    sendJson(response, 200, event);
    return;
  }
  if (request.method === "POST" && pathname === "/api/registrations") {
    const body = await readJson(request);
    const eventId = Number(body.event_id);
    if (!Number.isSafeInteger(eventId) || eventId <= 0) throw new HttpError(400, "Deze activiteit is ongeldig.");
    const name = requiredText(body.name, "je naam", 120);
    const email = validateEmail(body.email);

    db.exec("BEGIN IMMEDIATE");
    try {
      const event = db.prepare("SELECT id, date_time, capacity, status FROM events WHERE id = ?").get(eventId);
      if (!event || event.status !== "published") throw new HttpError(409, "Deze activiteit is niet beschikbaar om te boeken.");
      if (new Date(event.date_time) <= new Date()) throw new HttpError(409, "Deze activiteit heeft al plaatsgevonden.");
      if (db.prepare("SELECT id FROM registrations WHERE event_id = ? AND lower(email) = lower(?) AND status = 'active'").get(eventId, email)) {
        throw new HttpError(409, "Dit e-mailadres is al aangemeld voor deze activiteit.");
      }
      const active = db.prepare("SELECT COUNT(*) AS count FROM registrations WHERE event_id = ? AND status = 'active'").get(eventId).count;
      if (active >= event.capacity) throw new HttpError(409, "Deze activiteit is inmiddels volgeboekt.");
      const result = db.prepare(`INSERT INTO registrations (event_id, name, email, status, created_at)
        VALUES (?, ?, ?, 'active', ?)`).run(eventId, name, email, new Date().toISOString());
      db.exec("COMMIT");
      sendJson(response, 201, { id: Number(result.lastInsertRowid), message: "Je aanmelding is bevestigd." });
    } catch (error) {
      db.exec("ROLLBACK");
      if (error.code === "SQLITE_CONSTRAINT_UNIQUE") throw new HttpError(409, "Dit e-mailadres is al aangemeld voor deze activiteit.");
      throw error;
    }
    return;
  }

  if (request.method === "POST" && pathname === "/api/admin/login") {
    verifySameOrigin(request);
    const body = await readJson(request);
    const email = validateEmail(body.email);
    const password = typeof body.password === "string" ? body.password : "";
    const employee = db.prepare("SELECT id, email, password_hash FROM employees WHERE email = ?").get(email);
    if (!employee || !passwordMatches(password, employee.password_hash)) {
      throw new HttpError(401, "E-mailadres of wachtwoord is onjuist.");
    }
    const token = crypto.randomBytes(32).toString("hex");
    const key = crypto.createHash("sha256").update(token).digest("hex");
    sessions.set(key, { employeeId: employee.id, expiresAt: Date.now() + SESSION_TTL_MS });
    const secure = request.socket.encrypted || process.env.COOKIE_SECURE === "true" ? "; Secure" : "";
    response.setHeader("Set-Cookie", `brink_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}${secure}`);
    sendJson(response, 200, { email: employee.email });
    return;
  }
  if (request.method === "POST" && pathname === "/api/admin/logout") {
    verifySameOrigin(request);
    const token = parseCookies(request).get("brink_session");
    if (token && /^[a-f0-9]{64}$/.test(token)) sessions.delete(crypto.createHash("sha256").update(token).digest("hex"));
    response.setHeader("Set-Cookie", "brink_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
    sendJson(response, 200, { message: "Je bent uitgelogd." });
    return;
  }
  if (request.method === "GET" && pathname.startsWith("/api/admin/")) {
    const employee = requireEmployee(request);
    if (pathname === "/api/admin/dashboard") {
      const upcoming = db.prepare("SELECT COUNT(*) AS count FROM events WHERE status = 'published' AND date_time > ?").get(new Date().toISOString()).count;
      const registrations = db.prepare(`SELECT COUNT(*) AS count FROM registrations r
        JOIN events e ON e.id = r.event_id WHERE r.status = 'active' AND e.status = 'published' AND e.date_time > ?`).get(new Date().toISOString()).count;
      sendJson(response, 200, { upcoming_events: upcoming, active_registrations: registrations });
      return;
    }
    if (pathname === "/api/admin/events") {
      sendJson(response, 200, eventQuery("ORDER BY e.date_time DESC"));
      return;
    }
    if (pathname === "/api/admin/categories") {
      sendJson(response, 200, db.prepare("SELECT id, name FROM categories ORDER BY name").all());
      return;
    }
    const registrationsMatch = pathname.match(/^\/api\/admin\/events\/(\d+)\/registrations$/);
    if (registrationsMatch) {
      const eventId = Number(registrationsMatch[1]);
      if (!db.prepare("SELECT id FROM events WHERE id = ?").get(eventId)) throw new HttpError(404, "Deze activiteit is niet gevonden.");
      const registrations = db.prepare(`SELECT id, name, email, status, created_at FROM registrations
        WHERE event_id = ? ORDER BY created_at DESC`).all(eventId);
      sendJson(response, 200, registrations);
      return;
    }
    const csvMatch = pathname.match(/^\/api\/admin\/events\/(\d+)\/csv$/);
    if (csvMatch) {
      const eventId = Number(csvMatch[1]);
      const event = db.prepare("SELECT id, title FROM events WHERE id = ?").get(eventId);
      if (!event) throw new HttpError(404, "Deze activiteit is niet gevonden.");
      const registrations = db.prepare(`SELECT name, email, status, created_at FROM registrations
        WHERE event_id = ? ORDER BY created_at`).all(eventId);
      exportCsv(response, event, registrations);
      return;
    }
  }

  if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method) && pathname.startsWith("/api/admin/")) {
    verifySameOrigin(request);
    const employee = requireEmployee(request);
    if (request.method === "POST" && pathname === "/api/admin/registrations/reset") {
      db.exec("BEGIN IMMEDIATE");
      try {
        const deleted = db.prepare("DELETE FROM registrations").run().changes;
        db.exec("COMMIT");
        sendJson(response, 200, { deleted });
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return;
    }
    if (request.method === "POST" && pathname === "/api/admin/categories") {
      const body = await readJson(request);
      const name = requiredText(body.name, "een categorienaam", 80);
      try {
        const result = db.prepare("INSERT INTO categories (name) VALUES (?)").run(name);
        sendJson(response, 201, { id: Number(result.lastInsertRowid), name });
      } catch (error) {
        if (error.code === "SQLITE_CONSTRAINT_UNIQUE") throw new HttpError(409, "Deze categorienaam bestaat al.");
        throw error;
      }
      return;
    }
    const categoryMatch = pathname.match(/^\/api\/admin\/categories\/(\d+)$/);
    if (request.method === "PUT" && categoryMatch) {
      const body = await readJson(request);
      const name = requiredText(body.name, "een categorienaam", 80);
      try {
        const result = db.prepare("UPDATE categories SET name = ? WHERE id = ?").run(name, Number(categoryMatch[1]));
        if (result.changes === 0) throw new HttpError(404, "Deze categorie is niet gevonden.");
        sendJson(response, 200, { id: Number(categoryMatch[1]), name });
      } catch (error) {
        if (error.code === "SQLITE_CONSTRAINT_UNIQUE") throw new HttpError(409, "Deze categorienaam bestaat al.");
        throw error;
      }
      return;
    }
    if (request.method === "POST" && pathname === "/api/admin/events") {
      const activity = validateActivity(await readJson(request));
      const result = db.prepare(`INSERT INTO events
        (category_id, title, description, date_time, location, image_url, capacity, status, created_at, created_by_employee_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        activity.categoryId, activity.title, activity.description, activity.dateTime, activity.location,
        activity.imageUrl, activity.capacity, activity.status, new Date().toISOString(), employee.id
      );
      sendJson(response, 201, { id: Number(result.lastInsertRowid) });
      return;
    }
    const activityMatch = pathname.match(/^\/api\/admin\/events\/(\d+)$/);
    if (request.method === "PUT" && activityMatch) {
      const eventId = Number(activityMatch[1]);
      const activity = validateActivity(await readJson(request));
      db.exec("BEGIN IMMEDIATE");
      try {
        const current = db.prepare("SELECT id FROM events WHERE id = ?").get(eventId);
        if (!current) throw new HttpError(404, "Deze activiteit is niet gevonden.");
        const active = db.prepare("SELECT COUNT(*) AS count FROM registrations WHERE event_id = ? AND status = 'active'").get(eventId).count;
        if (activity.capacity < active) {
          throw new HttpError(409, `De capaciteit kan niet lager zijn dan de ${active} actieve aanmeldingen.`);
        }
        db.prepare(`UPDATE events SET category_id = ?, title = ?, description = ?, date_time = ?,
          location = ?, image_url = ?, capacity = ?, status = ? WHERE id = ?`).run(
          activity.categoryId, activity.title, activity.description, activity.dateTime, activity.location,
          activity.imageUrl, activity.capacity, activity.status, eventId
        );
        db.exec("COMMIT");
        sendJson(response, 200, { id: eventId });
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return;
    }
    const cancelMatch = pathname.match(/^\/api\/admin\/registrations\/(\d+)\/cancel$/);
    if (request.method === "POST" && cancelMatch) {
      const result = db.prepare("UPDATE registrations SET status = 'cancelled' WHERE id = ? AND status = 'active'").run(Number(cancelMatch[1]));
      if (result.changes === 0) throw new HttpError(404, "Deze actieve aanmelding is niet gevonden.");
      sendJson(response, 200, { message: "De aanmelding is geannuleerd." });
      return;
    }
  }

  if (pathname.startsWith("/api/")) throw new HttpError(404, "Deze API-route bestaat niet.");
  throw new HttpError(404, "Pagina niet gevonden.");
}

const server = http.createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    if (response.headersSent) {
      response.destroy(error);
      return;
    }
    if (error instanceof HttpError) {
      sendJson(response, error.status, { error: error.message });
      return;
    }
    console.error("Fout bij verzoek:", error);
    sendJson(response, 500, { error: "Er ging iets mis op de server. Probeer het later opnieuw." });
  });
});

server.listen(PORT, () => console.log(`Buurthuis Gultekin is bereikbaar op http://localhost:${PORT}`));

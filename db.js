import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// DATA_DIR: waar de DB + screenshots worden opgeslagen
// Railway: mount persistent volume op /data en zet DATA_DIR=/data
// Lokaal: default = project folder
export const DATA_DIR = process.env.DATA_DIR || __dirname;
export const SCREENSHOTS_DIR = path.join(DATA_DIR, "screenshots");
const DB_PATH = path.join(DATA_DIR, "klippr.db");

// Zorg dat directories bestaan
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(SCREENSHOTS_DIR))
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

console.log(`[db] opening ${DB_PATH}`);
export const db = new Database(DB_PATH);

// Performance & safety
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("synchronous = NORMAL");

// ─────────────────────────────────────────────────────────────
// SCHEMA
// ─────────────────────────────────────────────────────────────
db.exec(`
CREATE TABLE IF NOT EXISTS shops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  knipklok_url TEXT,
  twilio_number TEXT,
  owner_phone TEXT,
  dashboard_password TEXT,
  services_json TEXT,
  barbers_json TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id INTEGER NOT NULL DEFAULT 1,
  phone TEXT NOT NULL,
  name TEXT,
  email TEXT,
  visit_count INTEGER DEFAULT 0,
  favorite_barber TEXT,
  favorite_service TEXT,
  last_booking_date TEXT,
  booking_history TEXT DEFAULT '[]',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(shop_id, phone)
);

CREATE INDEX IF NOT EXISTS idx_customers_shop_phone ON customers(shop_id, phone);
CREATE INDEX IF NOT EXISTS idx_customers_last ON customers(last_booking_date);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ext_id TEXT UNIQUE,
  shop_id INTEGER NOT NULL DEFAULT 1,
  phone TEXT NOT NULL,
  phone_number TEXT,
  name TEXT,
  email TEXT,
  service TEXT,
  barber TEXT,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  status TEXT DEFAULT 'confirmed',
  screenshot TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date);
CREATE INDEX IF NOT EXISTS idx_bookings_shop_date ON bookings(shop_id, date);
CREATE INDEX IF NOT EXISTS idx_bookings_phone ON bookings(phone);

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id INTEGER NOT NULL DEFAULT 1,
  phone TEXT NOT NULL,
  messages_json TEXT NOT NULL,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(shop_id, phone)
);

CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at);

CREATE TABLE IF NOT EXISTS reminders_sent (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  sent_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(booking_id, type)
);
`);

// ─────────────────────────────────────────────────────────────
// DEFAULT SHOP SEEDING
// ─────────────────────────────────────────────────────────────
// Voor nu werken we met 1 shop. Multi-tenant komt later.
// DEFAULT_SHOP_ID wordt gebruikt in alle queries tot we per-request shop detection toevoegen.
export const DEFAULT_SHOP_ID = 1;

const existingShop = db
  .prepare("SELECT * FROM shops WHERE id = ?")
  .get(DEFAULT_SHOP_ID);

if (!existingShop) {
  db.prepare(
    `INSERT INTO shops (id, slug, name, knipklok_url, twilio_number, owner_phone, dashboard_password)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    DEFAULT_SHOP_ID,
    "kapsalon-the-future",
    process.env.SHOP_NAME || "Kapsalon The Future",
    "https://knipklok.nl/kapperszaak/kapsalon-the-future/afspraak",
    process.env.TWILIO_WHATSAPP_FROM || "",
    process.env.BARBER_PHONE || "",
    process.env.DASHBOARD_PASSWORD || "klippr2026"
  );
  console.log("[db] seeded default shop (id=1)");
}

// ─────────────────────────────────────────────────────────────
// SHOPS API
// ─────────────────────────────────────────────────────────────
export const shopsDb = {
  get(id = DEFAULT_SHOP_ID) {
    return db.prepare("SELECT * FROM shops WHERE id = ?").get(id);
  },
  getBySlug(slug) {
    return db.prepare("SELECT * FROM shops WHERE slug = ?").get(slug);
  },
  getByTwilioNumber(number) {
    return db
      .prepare("SELECT * FROM shops WHERE twilio_number = ?")
      .get(number);
  },
  updateConfig(id, updates) {
    const fields = Object.keys(updates)
      .map((k) => `${k} = ?`)
      .join(", ");
    const values = Object.values(updates);
    db.prepare(`UPDATE shops SET ${fields} WHERE id = ?`).run(...values, id);
  },
};

// ─────────────────────────────────────────────────────────────
// CUSTOMERS API
// ─────────────────────────────────────────────────────────────
function normalizePhone(phone) {
  return String(phone || "").replace("whatsapp:", "").trim();
}

export const customersDb = {
  get(phone, shopId = DEFAULT_SHOP_ID) {
    const row = db
      .prepare("SELECT * FROM customers WHERE shop_id = ? AND phone = ?")
      .get(shopId, normalizePhone(phone));
    if (!row) return null;
    return {
      ...row,
      visitCount: row.visit_count,
      favoriteBarber: row.favorite_barber,
      favoriteService: row.favorite_service,
      lastBookingDate: row.last_booking_date,
      bookingHistory: JSON.parse(row.booking_history || "[]"),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  },

  upsert(phone, data, shopId = DEFAULT_SHOP_ID) {
    const key = normalizePhone(phone);
    const existing = this.get(key, shopId);
    if (existing) {
      db.prepare(
        `UPDATE customers
         SET name = COALESCE(?, name),
             email = COALESCE(?, email),
             updated_at = CURRENT_TIMESTAMP
         WHERE shop_id = ? AND phone = ?`
      ).run(data.name || null, data.email || null, shopId, key);
    } else {
      db.prepare(
        `INSERT INTO customers (shop_id, phone, name, email)
         VALUES (?, ?, ?, ?)`
      ).run(shopId, key, data.name || null, data.email || null);
    }
    return this.get(key, shopId);
  },

  recordBooking(phone, booking, shopId = DEFAULT_SHOP_ID) {
    const key = normalizePhone(phone);
    const existing = this.get(key, shopId);

    const history = existing?.bookingHistory || [];
    history.push({
      date: booking.date,
      time: booking.time,
      service: booking.service,
      barber: booking.barber,
      bookedAt: new Date().toISOString(),
    });

    // Bereken favorieten
    const barberCount = {};
    const serviceCount = {};
    history.forEach((b) => {
      if (b.barber) barberCount[b.barber] = (barberCount[b.barber] || 0) + 1;
      if (b.service) serviceCount[b.service] = (serviceCount[b.service] || 0) + 1;
    });
    const favoriteBarber =
      Object.entries(barberCount).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    const favoriteService =
      Object.entries(serviceCount).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

    if (existing) {
      db.prepare(
        `UPDATE customers
         SET name = ?, email = ?,
             visit_count = visit_count + 1,
             last_booking_date = ?,
             favorite_barber = ?,
             favorite_service = ?,
             booking_history = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE shop_id = ? AND phone = ?`
      ).run(
        booking.name || existing.name,
        booking.email || existing.email,
        booking.date,
        favoriteBarber,
        favoriteService,
        JSON.stringify(history),
        shopId,
        key
      );
    } else {
      db.prepare(
        `INSERT INTO customers (shop_id, phone, name, email, visit_count, last_booking_date, favorite_barber, favorite_service, booking_history)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)`
      ).run(
        shopId,
        key,
        booking.name || null,
        booking.email || null,
        booking.date,
        favoriteBarber,
        favoriteService,
        JSON.stringify(history)
      );
    }
    return this.get(key, shopId);
  },

  all(shopId = DEFAULT_SHOP_ID) {
    const rows = db
      .prepare(
        "SELECT * FROM customers WHERE shop_id = ? ORDER BY last_booking_date DESC, created_at DESC"
      )
      .all(shopId);
    return rows.map((row) => ({
      ...row,
      visitCount: row.visit_count,
      favoriteBarber: row.favorite_barber,
      favoriteService: row.favorite_service,
      lastBookingDate: row.last_booking_date,
      bookingHistory: JSON.parse(row.booking_history || "[]"),
      createdAt: row.created_at,
    }));
  },

  inactive(weeksThreshold = 5, shopId = DEFAULT_SHOP_ID) {
    const cutoff = new Date(
      Date.now() - weeksThreshold * 7 * 86400000
    ).toISOString().slice(0, 10);
    const rows = db
      .prepare(
        `SELECT * FROM customers
         WHERE shop_id = ? AND last_booking_date IS NOT NULL AND last_booking_date < ?`
      )
      .all(shopId, cutoff);
    return rows.map((row) => ({
      ...row,
      visitCount: row.visit_count,
      favoriteBarber: row.favorite_barber,
      lastBookingDate: row.last_booking_date,
    }));
  },

  stats(shopId = DEFAULT_SHOP_ID) {
    const total = db
      .prepare("SELECT COUNT(*) as c FROM customers WHERE shop_id = ?")
      .get(shopId).c;
    const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString();
    const newThisMonth = db
      .prepare(
        "SELECT COUNT(*) as c FROM customers WHERE shop_id = ? AND created_at > ?"
      )
      .get(shopId, monthAgo).c;
    const inactive = this.inactive(5, shopId).length;
    return { total, newThisMonth, inactive };
  },
};

// ─────────────────────────────────────────────────────────────
// BOOKINGS API
// ─────────────────────────────────────────────────────────────
export const bookingsDb = {
  add(booking, shopId = DEFAULT_SHOP_ID) {
    const extId = booking.id || `BK-${Date.now()}`;
    const info = db
      .prepare(
        `INSERT INTO bookings
         (ext_id, shop_id, phone, phone_number, name, email, service, barber, date, time, status, screenshot, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        extId,
        shopId,
        booking.phone,
        booking.phoneNumber || null,
        booking.name || null,
        booking.email || null,
        booking.service || null,
        booking.barber || null,
        booking.date,
        booking.time,
        booking.status || "confirmed",
        booking.screenshot || null,
        booking.createdAt || new Date().toISOString()
      );
    return { id: info.lastInsertRowid, ext_id: extId, ...booking };
  },

  getToday(shopId = DEFAULT_SHOP_ID) {
    const today = new Date().toISOString().slice(0, 10);
    return db
      .prepare(
        "SELECT * FROM bookings WHERE shop_id = ? AND date = ? ORDER BY time ASC"
      )
      .all(shopId, today)
      .map(this._mapRow);
  },

  getUpcoming(shopId = DEFAULT_SHOP_ID) {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const nowTime = now.toTimeString().slice(0, 5);

    return db
      .prepare(
        `SELECT * FROM bookings
         WHERE shop_id = ?
           AND status != 'cancelled'
           AND (date > ? OR (date = ? AND time >= ?))
         ORDER BY date ASC, time ASC`
      )
      .all(shopId, today, today, nowTime)
      .map(this._mapRow);
  },

  all(shopId = DEFAULT_SHOP_ID) {
    return db
      .prepare(
        "SELECT * FROM bookings WHERE shop_id = ? ORDER BY date DESC, time DESC"
      )
      .all(shopId)
      .map(this._mapRow);
  },

  _mapRow(row) {
    return {
      id: row.ext_id || `BK-${row.id}`,
      internalId: row.id,
      phone: row.phone,
      phoneNumber: row.phone_number,
      name: row.name,
      email: row.email,
      service: row.service,
      barber: row.barber,
      date: row.date,
      time: row.time,
      status: row.status,
      screenshot: row.screenshot,
      createdAt: row.created_at,
    };
  },
};

// ─────────────────────────────────────────────────────────────
// CONVERSATIONS API (persistent chat history)
// ─────────────────────────────────────────────────────────────
export const conversationsDb = {
  get(phone, shopId = DEFAULT_SHOP_ID) {
    const row = db
      .prepare(
        "SELECT messages_json FROM conversations WHERE shop_id = ? AND phone = ?"
      )
      .get(shopId, normalizePhone(phone));
    if (!row) return [];
    try {
      return JSON.parse(row.messages_json);
    } catch {
      return [];
    }
  },

  save(phone, messages, shopId = DEFAULT_SHOP_ID) {
    const key = normalizePhone(phone);
    const json = JSON.stringify(messages);
    db.prepare(
      `INSERT INTO conversations (shop_id, phone, messages_json, updated_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(shop_id, phone) DO UPDATE SET
         messages_json = excluded.messages_json,
         updated_at = CURRENT_TIMESTAMP`
    ).run(shopId, key, json);
  },

  // Oude gesprekken opruimen (>30 dagen oud)
  cleanup(daysOld = 30) {
    const cutoff = new Date(Date.now() - daysOld * 86400000).toISOString();
    const info = db
      .prepare("DELETE FROM conversations WHERE updated_at < ?")
      .run(cutoff);
    return info.changes;
  },
};

// ─────────────────────────────────────────────────────────────
// REMINDERS API
// ─────────────────────────────────────────────────────────────
export const remindersDb = {
  isSent(bookingId, type) {
    const row = db
      .prepare(
        "SELECT 1 FROM reminders_sent WHERE booking_id = ? AND type = ?"
      )
      .get(bookingId, type);
    return !!row;
  },

  markSent(bookingId, type) {
    try {
      db.prepare(
        "INSERT INTO reminders_sent (booking_id, type) VALUES (?, ?)"
      ).run(bookingId, type);
    } catch (e) {
      // UNIQUE constraint — al verstuurd, negeer
    }
  },
};

// ─────────────────────────────────────────────────────────────
// HEALTH + STATS
// ─────────────────────────────────────────────────────────────
export function getDbStats() {
  return {
    shops: db.prepare("SELECT COUNT(*) as c FROM shops").get().c,
    customers: db.prepare("SELECT COUNT(*) as c FROM customers").get().c,
    bookings: db.prepare("SELECT COUNT(*) as c FROM bookings").get().c,
    conversations: db.prepare("SELECT COUNT(*) as c FROM conversations").get().c,
    dbPath: DB_PATH,
    dbSizeBytes: fs.existsSync(DB_PATH) ? fs.statSync(DB_PATH).size : 0,
  };
}

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("[db] closing database");
  db.close();
});
process.on("SIGINT", () => {
  console.log("[db] closing database");
  db.close();
  process.exit(0);
});

console.log("[db] schema ready");

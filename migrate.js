// Eenmalig migratie script: bookings.json + customers.json + reminders-sent.json → SQLite
// Run met: node migrate.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { db, bookingsDb, customersDb, DEFAULT_SHOP_ID } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadJson(file) {
  try {
    const p = path.join(__dirname, file);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    console.error(`[migrate] fail to load ${file}:`, e.message);
    return null;
  }
}

console.log("\n🔄 Klippr data migratie: JSON → SQLite\n");

// ─────────────────────────────────────────────────────────────
// 1. BOOKINGS
// ─────────────────────────────────────────────────────────────
const bookingsJson = loadJson("bookings.json");
if (Array.isArray(bookingsJson) && bookingsJson.length > 0) {
  console.log(`📖 ${bookingsJson.length} bookings gevonden in bookings.json`);

  let imported = 0;
  let skipped = 0;

  const tx = db.transaction((bookings) => {
    for (const b of bookings) {
      // Check of deze ext_id al bestaat
      const exists = db
        .prepare("SELECT 1 FROM bookings WHERE ext_id = ?")
        .get(b.id);
      if (exists) {
        skipped++;
        continue;
      }
      bookingsDb.add(
        {
          id: b.id,
          phone: b.phone,
          phoneNumber: b.phoneNumber,
          name: b.name,
          email: b.email,
          service: b.service,
          barber: b.barber,
          date: b.date,
          time: b.time,
          status: "confirmed",
          screenshot: b.screenshot,
          createdAt: b.createdAt,
        },
        DEFAULT_SHOP_ID
      );
      imported++;
    }
  });
  tx(bookingsJson);

  console.log(`   ✅ ${imported} geïmporteerd, ⏭️  ${skipped} al aanwezig`);
} else {
  console.log("📖 Geen bookings.json of leeg — skip");
}

// ─────────────────────────────────────────────────────────────
// 2. CUSTOMERS (direct uit file én afgeleid van bookings)
// ─────────────────────────────────────────────────────────────
const customersJson = loadJson("customers.json");
if (customersJson && typeof customersJson === "object") {
  const entries = Object.entries(customersJson);
  console.log(`👥 ${entries.length} customers gevonden in customers.json`);

  let imported = 0;
  for (const [phone, c] of entries) {
    try {
      // Simpele upsert via bookings history
      if (c.bookingHistory?.length) {
        for (const b of c.bookingHistory) {
          customersDb.recordBooking(
            phone,
            {
              name: c.name,
              email: c.email,
              date: b.date,
              time: b.time,
              service: b.service,
              barber: b.barber,
            },
            DEFAULT_SHOP_ID
          );
        }
      } else {
        customersDb.upsert(
          phone,
          { name: c.name, email: c.email },
          DEFAULT_SHOP_ID
        );
      }
      imported++;
    } catch (e) {
      console.error(`   ❌ ${phone}: ${e.message}`);
    }
  }
  console.log(`   ✅ ${imported} customers geïmporteerd`);
} else {
  console.log("👥 Geen customers.json — afleiden uit bookings...");

  // Alle boekingen ophalen en customer profiles opbouwen
  const allBookings = bookingsDb.all(DEFAULT_SHOP_ID);
  const byPhone = {};
  for (const b of allBookings) {
    if (!byPhone[b.phone]) byPhone[b.phone] = [];
    byPhone[b.phone].push(b);
  }

  let imported = 0;
  for (const [phone, bookings] of Object.entries(byPhone)) {
    // Sorteer op datum asc zodat recordBooking chronologisch loopt
    bookings.sort((a, b) =>
      `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`)
    );
    for (const b of bookings) {
      customersDb.recordBooking(
        phone,
        {
          name: b.name,
          email: b.email,
          date: b.date,
          time: b.time,
          service: b.service,
          barber: b.barber,
        },
        DEFAULT_SHOP_ID
      );
    }
    imported++;
  }
  console.log(`   ✅ ${imported} customer profiles afgeleid uit bookings`);
}

// ─────────────────────────────────────────────────────────────
// 3. REMINDERS SENT
// ─────────────────────────────────────────────────────────────
const remindersJson = loadJson("reminders-sent.json");
if (remindersJson && typeof remindersJson === "object") {
  const keys = Object.keys(remindersJson);
  console.log(`⏰ ${keys.length} reminder states gevonden`);

  let imported = 0;
  for (const key of keys) {
    const [extId, type] = key.split(":");
    if (!extId || !type) continue;
    const booking = db
      .prepare("SELECT id FROM bookings WHERE ext_id = ?")
      .get(extId);
    if (!booking) continue;
    try {
      db.prepare(
        "INSERT OR IGNORE INTO reminders_sent (booking_id, type, sent_at) VALUES (?, ?, ?)"
      ).run(booking.id, type, remindersJson[key] || new Date().toISOString());
      imported++;
    } catch (e) {}
  }
  console.log(`   ✅ ${imported} reminders geïmporteerd`);
} else {
  console.log("⏰ Geen reminders-sent.json — skip");
}

// ─────────────────────────────────────────────────────────────
// DONE
// ─────────────────────────────────────────────────────────────
const stats = {
  customers: db.prepare("SELECT COUNT(*) as c FROM customers").get().c,
  bookings: db.prepare("SELECT COUNT(*) as c FROM bookings").get().c,
  reminders: db.prepare("SELECT COUNT(*) as c FROM reminders_sent").get().c,
};

console.log("\n📊 Database state na migratie:");
console.log(`   - Customers:      ${stats.customers}`);
console.log(`   - Bookings:       ${stats.bookings}`);
console.log(`   - Reminders sent: ${stats.reminders}`);

console.log("\n✅ Migratie klaar!\n");
console.log("💡 Tip: oude JSON files zijn NIET verwijderd.");
console.log("   Als alles werkt kun je ze handmatig verplaatsen naar een backup.\n");

process.exit(0);

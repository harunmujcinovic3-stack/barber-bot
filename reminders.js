import { getAllUpcoming } from "./bookings.js";
import { remindersDb } from "./db.js";

// Check elke minuut: afspraken binnen 15-25 min → stuur 20-min reminder
export function startReminderLoop(sendWhatsApp) {
  console.log("[reminders] 20-min pre-reminder loop started");

  const check = async () => {
    try {
      const upcoming = getAllUpcoming();
      const now = Date.now();

      for (const booking of upcoming) {
        if (!booking.date || !booking.time) continue;

        const appointmentTime = new Date(
          `${booking.date}T${booking.time}:00`
        ).getTime();
        const minutesUntil = Math.round((appointmentTime - now) / 60000);

        // 15-25 min voor afspraak → stuur reminder (1 keer)
        if (minutesUntil >= 15 && minutesUntil <= 25) {
          // Booking id kan internalId zijn (SQLite PK) of ext_id; we gebruiken internalId
          const bookingDbId = booking.internalId || booking.id;
          if (remindersDb.isSent(bookingDbId, "pre20")) continue;

          const barberText =
            booking.barber && booking.barber !== "maakt niet uit"
              ? ` bij ${booking.barber}`
              : "";
          const msg = `Yo ${booking.name || "bro"} 💈 kleine reminder: over ${minutesUntil} min ben je${barberText} voor je afspraak van ${booking.time}. Tot zo man 👊`;

          try {
            await sendWhatsApp(booking.phone, msg);
            remindersDb.markSent(bookingDbId, "pre20");
            console.log(
              `[reminders] ✅ 20-min reminder → ${booking.phone} (${booking.name})`
            );
          } catch (e) {
            console.error(
              `[reminders] kon ${booking.phone} niet bereiken:`,
              e.message
            );
          }
        }
      }
    } catch (e) {
      console.error("[reminders] loop error:", e.message);
    }
  };

  // Eerste check meteen, daarna elke 60 sec
  check();
  return setInterval(check, 60 * 1000);
}

// Reactivatie — vanuit dashboard knop
export async function sendReactivationMessages(inactiveCustomers, sendWhatsApp) {
  let sent = 0;
  for (const c of inactiveCustomers) {
    const msg = `Yo ${c.name || "bro"} 💈 al ff geleden! Tijd voor een fresh cut? Stuur gwn je gewenste dag en we zetten je erin 👊`;
    try {
      await sendWhatsApp(`whatsapp:${c.phone}`, msg);
      sent++;
    } catch (e) {
      console.error(`[reactivation] fail ${c.phone}:`, e.message);
    }
  }
  return sent;
}

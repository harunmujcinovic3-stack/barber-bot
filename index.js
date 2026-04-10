import "dotenv/config";
import express from "express";
import OpenAI from "openai";
import twilio from "twilio";
import { checkAvailability, bookAppointment, SERVICES, BARBERS } from "./knipklok.js";
import { addBooking, getTodaysBookings, getAllUpcoming } from "./bookings.js";
import {
  getCustomer,
  upsertCustomer,
  recordBooking,
  getInactiveCustomers,
} from "./customers.js";
import { mountDashboard, dashboardAuth } from "./dashboard.js";
import { startReminderLoop, sendReactivationMessages } from "./reminders.js";
import { conversationsDb, getDbStats } from "./db.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const twilioClient =
  process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
    ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
    : null;

const TWILIO_FROM = process.env.TWILIO_WHATSAPP_FROM || "whatsapp:+14155238886";
const BARBER_PHONE = process.env.BARBER_PHONE;
const SHOP_NAME = process.env.SHOP_NAME || "Kapsalon The Future";

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Simpele cookie parser (voor dashboard auth)
app.use((req, res, next) => {
  req.cookies = {};
  const cookie = req.headers.cookie;
  if (cookie) {
    cookie.split(";").forEach((c) => {
      const [k, v] = c.trim().split("=");
      req.cookies[k] = v;
    });
  }
  next();
});

// Persistent conversation history via SQLite
// API blijft Map-achtig voor minimale refactor verderop
const conversations = {
  get(phone) {
    return conversationsDb.get(phone);
  },
  set(phone, messages) {
    conversationsDb.save(phone, messages);
  },
};

const SERVICE_LIST = Object.entries(SERVICES)
  .map(([key, s]) => `- ${s.label} — €${s.price} (key: ${key})`)
  .join("\n");

function buildSystemPrompt(customer) {
  let customerInfo = "";
  if (customer && customer.name) {
    customerInfo = `

🧠 DEZE KLANT KEN JE AL:
- Naam: ${customer.name}
- Email: ${customer.email || "onbekend"}
- Aantal eerdere bezoeken: ${customer.visitCount || 0}
- Favoriete kapper: ${customer.favoriteBarber || "geen voorkeur bekend"}
- Favoriete service: ${customer.favoriteService ? SERVICES[customer.favoriteService]?.label : "geen voorkeur bekend"}
- Laatste bezoek: ${customer.lastBookingDate || "onbekend"}

⚠️ BELANGRIJK VOOR RETURNING KLANTEN:
- Begroet hem bij naam ("Yo ${customer.name}!")
- Vraag NIET opnieuw om naam/email — je weet ze al
- Als hij een service/kapper niet noemt, mag je zijn favoriete voorstellen: "Doe maar zoals altijd bij ${customer.favoriteBarber}?"
- Bij book_appointment: gebruik gewoon zijn opgeslagen naam "${customer.name}" en email "${customer.email || ""}"
`;
  } else {
    customerInfo = `

🆕 NIEUWE KLANT:
- Je kent hem nog niet, vraag naam en email wanneer je gaat boeken
`;
  }

  return `
Je bent de WhatsApp assistent van ${SHOP_NAME}. Je klinkt als een echte kapper:
casual, chill, gebruik woorden zoals "bro", "man", "joo", "broer", "safe".
Praat Nederlands. Korte zinnen. Af en toe een emoji (💈 ✂️ 👊).

🏪 Kapsalon: ${SHOP_NAME}
🧑 Kappers: Mo, Anass, Ayman (of "maakt niet uit")
⏰ Geopend: Ma-Za 09:00 - 19:30. ZONDAG GESLOTEN.

💈 Diensten en prijzen:
${SERVICE_LIST}
${customerInfo}

🎯 VOORBEELD GESPREK (nieuwe klant):
Klant: Joo bro
Kapper: Yo man!
Klant: Heb je morgen ff tijd om te knippen?
Kapper: Ik ga ff voor je checken, wanneer wil je het liefst? En bij wie wil je knippen, Mo, Anass of Ayman?
Klant: Rond 19:00 en doe maar Anass
Kapper: Ja man, 19:00 bij Anass moet lukken 👌
Klant: Top broer
Kapper: Ik zet je erin, heb je nog ff je naam en e-mail voor de bevestiging?
Klant: Ja man, Harun en harun@email.com
Kapper: Perfect, je krijgt zo een bevestiging binnen

🎯 VOORBEELD (returning klant):
Klant: Joo bro
Kapper: Yo ${customer?.name || "Harun"}! Alles goed man?
Klant: Ja man, knippen morgen 15:00?
Kapper: Bij ${customer?.favoriteBarber || "Mo"} zoals altijd? Ga ff checken 👌
(→ roept check_availability aan, dan book_appointment met opgeslagen naam/email)

🛠️ BELANGRIJKE REGELS:
- Als klant om beschikbaarheid vraagt → ROEP check_availability aan
- ⚠️ KRITIEK: Gebruik ALLEEN tijden die letterlijk in de slots lijst van check_availability staan
- Als de klant een tijd vraagt die NIET in de slots lijst staat, zeg dat eerlijk en noem alternatieven uit de lijst
- Verzin NOOIT tijden, zelfs niet als "logisch" zou lijken
- Geef MAX 3-4 tijden rond wat de klant wil (geen hele lijst dumpen), maar altijd UIT de echte lijst
- Vraag ALTIJD welke kapper (Mo, Anass, Ayman, of maakt niet uit) — tenzij returning klant een favoriet heeft
- Voor boeken heb je nodig: service, datum, tijd, kapper, naam, email
- Telefoonnummer hoef je niet te vragen, dat heb ik al
- Zondag = gesloten, bied vrijdag/zaterdag/maandag aan
- Als je alles hebt → ROEP book_appointment aan
- Als book_appointment een fout geeft met availableSlots, bied die tijden aan
`.trim();
}

const TOOLS = [
  {
    type: "function",
    function: {
      name: "check_availability",
      description: "Checkt beschikbare tijden bij de kapsalon.",
      parameters: {
        type: "object",
        properties: {
          service: { type: "string", enum: Object.keys(SERVICES) },
          when: {
            type: "string",
            description: "'vandaag', 'morgen', een weekdag ('maandag'), of dagnummer ('15')",
          },
          barber: { type: "string", enum: [...BARBERS, "maakt niet uit"] },
        },
        required: ["service", "when"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "book_appointment",
      description: "Boekt ECHT een afspraak. Alleen aanroepen als je ALLES hebt.",
      parameters: {
        type: "object",
        properties: {
          service: { type: "string", enum: Object.keys(SERVICES) },
          when: { type: "string" },
          time: { type: "string", description: "HH:MM" },
          barber: { type: "string", enum: [...BARBERS, "maakt niet uit"] },
          name: { type: "string" },
          email: { type: "string" },
        },
        required: ["service", "when", "time", "barber", "name", "email"],
      },
    },
  },
];

function normalizeBarber(b) {
  if (!b) return null;
  if (String(b).toLowerCase().includes("maakt")) return null;
  return b;
}

function whenToDate(when) {
  const w = String(when).toLowerCase();
  const now = new Date();
  if (w === "vandaag") return now.toISOString().slice(0, 10);
  if (w === "morgen")
    return new Date(now.getTime() + 86400000).toISOString().slice(0, 10);
  if (/^\d+$/.test(w)) {
    const day = parseInt(w);
    const t = new Date(now.getFullYear(), now.getMonth(), day);
    if (t < now) t.setMonth(t.getMonth() + 1);
    return t.toISOString().slice(0, 10);
  }
  return w;
}

async function getAIResponse(phone, userMessage) {
  // 🧠 Customer memory lookup
  const customer = getCustomer(phone);
  const systemPrompt = buildSystemPrompt(customer);

  let history = conversations.get(phone);
  if (!Array.isArray(history)) history = [];
  history.push({ role: "user", content: userMessage });
  if (history.length > 14) history = history.slice(-14);

  let response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "system", content: systemPrompt }, ...history],
    tools: TOOLS,
    tool_choice: "auto",
    temperature: 0.7,
  });

  let msg = response.choices[0].message;
  history.push(msg);

  let rounds = 0;
  while (msg.tool_calls?.length && rounds < 3) {
    rounds++;
    for (const call of msg.tool_calls) {
      const args = JSON.parse(call.function.arguments);
      let result;

      if (call.function.name === "check_availability") {
        console.log(`[tool] checkAvailability`, args);
        result = await checkAvailability({
          service: args.service,
          when: args.when,
          barber: normalizeBarber(args.barber),
        });
        if (result.success) {
          console.log(
            `[tool] ${result.closed ? "CLOSED" : result.slots.length + " slots"}`
          );
        } else {
          console.log(`[tool] ERROR:`, result.error);
        }
      }

      if (call.function.name === "book_appointment") {
        console.log(`[tool] bookAppointment`, args);
        const phoneNumber = phone.replace("whatsapp:", "");

        // Override met opgeslagen klantdata als die bestaat
        const finalName = customer?.name || args.name;
        const finalEmail = customer?.email || args.email;

        result = await bookAppointment({
          service: args.service,
          when: args.when,
          time: args.time,
          barber: normalizeBarber(args.barber),
          name: finalName,
          email: finalEmail,
          phone: phoneNumber,
        });
        console.log(
          `[tool] booking:`,
          result.success ? "✅ CONFIRMED" : `❌ ${result.error}`
        );

        if (result.success) {
          const bookingRecord = {
            phone,
            phoneNumber,
            name: finalName,
            email: finalEmail,
            service: args.service,
            barber: args.barber,
            date: whenToDate(args.when),
            time: args.time,
            screenshot: result.screenshot,
          };
          addBooking(bookingRecord);

          // 🧠 Update customer profile
          recordBooking(phone, {
            name: finalName,
            email: finalEmail,
            service: args.service,
            barber: args.barber,
            date: whenToDate(args.when),
            time: args.time,
          });
        }
      }

      history.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }

    response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: systemPrompt }, ...history],
      tools: TOOLS,
      tool_choice: "auto",
      temperature: 0.7,
    });
    msg = response.choices[0].message;
    history.push(msg);
  }

  conversations.set(phone, history);
  return msg.content;
}

// ─────────────────────────────────────────────────────────────
// WhatsApp helpers
// ─────────────────────────────────────────────────────────────
async function sendWhatsApp(to, body) {
  if (!twilioClient) {
    console.log(`[would send to ${to}]:`, body);
    return;
  }
  try {
    return await twilioClient.messages.create({ from: TWILIO_FROM, to, body });
  } catch (e) {
    console.error(`[twilio] send failed:`, e.message);
  }
}

// ─────────────────────────────────────────────────────────────
// Uitloop commando detectie (alleen kapper via WhatsApp)
// ─────────────────────────────────────────────────────────────
async function handleDelayCommand(fromPhone, body) {
  if (!BARBER_PHONE || fromPhone !== BARBER_PHONE) return false;
  const match = body.match(
    /(?:uitloop|loop|delay|vertraging)[\s:]*(\d+)\s*(?:min|minuten)?/i
  );
  if (!match) return false;

  const minutes = parseInt(match[1]);
  const sent = await sendDelayNotifications(minutes);

  if (sent === 0) {
    await sendWhatsApp(fromPhone, `Geen afspraken vandaag om te notificeren 👍`);
  } else {
    await sendWhatsApp(
      fromPhone,
      `Safe man, ${sent} klanten geïnformeerd over ${minutes} min uitloop 👊`
    );
  }
  return true;
}

async function sendDelayNotifications(minutes) {
  const todays = getTodaysBookings();
  if (todays.length === 0) return 0;

  let sent = 0;
  for (const booking of todays) {
    try {
      await sendWhatsApp(
        booking.phone,
        `Yo ${booking.name}, kleine update — ${booking.barber} loopt ongeveer ${minutes} min uit. Je afspraak van ${booking.time} schuift iets op. Sorry voor het wachten bro 🙏`
      );
      sent++;
    } catch (e) {
      console.error(`[delay] kon ${booking.phone} niet bereiken:`, e.message);
    }
  }
  return sent;
}

// ─────────────────────────────────────────────────────────────
// ERROR ALERTING — stuur WhatsApp naar eigenaar bij ernstige fouten
// ─────────────────────────────────────────────────────────────
let lastAlertAt = 0;
async function alertOwner(title, details = "") {
  const now = Date.now();
  // Rate limit: max 1 alert per 5 min om niet spammen bij crash loops
  if (now - lastAlertAt < 5 * 60 * 1000) return;
  lastAlertAt = now;

  const msg = `🚨 Klippr alert\n${title}\n${details}`.slice(0, 1400);
  console.error("[ALERT]", title, details);
  if (BARBER_PHONE) {
    try {
      await sendWhatsApp(BARBER_PHONE, msg);
    } catch (e) {
      console.error("[alert] failed to send owner alert:", e.message);
    }
  }
}

process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
  alertOwner("Unhandled promise rejection", String(reason).slice(0, 500));
});
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
  alertOwner("Uncaught exception", err.message || String(err));
  // Laat process niet sterven op exceptions — Railway restart is heftiger dan recovery
});

// ─────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────
const BOOT_TIME = Date.now();
app.get("/", (req, res) => res.send("Klippr 💈 — bot is live 🔥"));
app.get("/health", (req, res) => {
  try {
    const stats = getDbStats();
    res.json({
      status: "ok",
      service: "klippr",
      version: "1.0.0",
      uptimeSec: Math.round((Date.now() - BOOT_TIME) / 1000),
      db: stats,
      twilio: !!twilioClient,
      openai: !!process.env.OPENAI_API_KEY,
    });
  } catch (e) {
    res.status(500).json({ status: "error", error: e.message });
  }
});
app.get("/bookings", (req, res) => {
  const all = getAllUpcoming();
  res.json({ count: all.length, bookings: all });
});

// Dashboard
mountDashboard(app);

// Dashboard acties (uitloop + reactivatie)
app.post("/dashboard/delay", dashboardAuth, async (req, res) => {
  const minutes = parseInt(req.body.minutes) || 10;
  const sent = await sendDelayNotifications(minutes);
  res.redirect("/dashboard");
  console.log(`[dashboard] uitloop ${minutes} min → ${sent} klanten`);
});

app.post("/dashboard/reactivate", dashboardAuth, async (req, res) => {
  const inactive = getInactiveCustomers(5);
  const sent = await sendReactivationMessages(inactive, sendWhatsApp);
  res.redirect("/dashboard/customers");
  console.log(`[dashboard] reactivatie → ${sent} klanten`);
});

app.post("/webhook/twilio", async (req, res) => {
  const from = req.body.From;
  const body = req.body.Body?.trim();

  console.log(`\n[${from}] ${body}`);

  // ⚡ ASYNC RESPONSE: direct OK aan Twilio, dan achtergrondwerk
  res.set("Content-Type", "text/xml");
  res.send(`<Response></Response>`);

  (async () => {
    try {
      // Uitloop commando?
      const isDelay = await handleDelayCommand(from, body);
      if (isDelay) return;

      // Normale AI flow
      const reply = await getAIResponse(from, body);
      console.log(`[bot] ${reply}`);

      if (reply) {
        await sendWhatsApp(from, reply);
      }
    } catch (err) {
      console.error("[error]", err);
      await sendWhatsApp(
        from,
        "Sorry bro, er ging iets mis. Probeer het zo nog een keer 🙏"
      );
    }
  })();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("");
  console.log("╔════════════════════════════════════╗");
  console.log("║  💈  KLIPPR  v1.0                  ║");
  console.log("╚════════════════════════════════════╝");
  console.log(`🚀 server running on port ${PORT}`);
  console.log(`🏪 shop: ${SHOP_NAME}`);
  console.log(`📊 dashboard: http://localhost:${PORT}/dashboard?pw=${process.env.DASHBOARD_PASSWORD || "klippr2026"}`);
  console.log(`💈 AI brain: ACTIVE`);
  console.log(`🧠 customer memory: ACTIVE`);
  console.log(`🔗 Knipklok scraper: READY`);
  console.log(`📖 booking tracking: ACTIVE`);
  console.log(
    `⚡ async responses: ${twilioClient ? "ACTIVE" : "⚠️  geen Twilio credentials — bot kan niet antwoorden!"}`
  );
  console.log(
    `⏰ delay notifications: ${BARBER_PHONE ? "READY" : "⚠️  geen BARBER_PHONE"}`
  );

  // Start 20-min reminder loop
  startReminderLoop(sendWhatsApp);
  console.log("");
});

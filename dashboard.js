import { getAllUpcoming, getTodaysBookings, getAll } from "./bookings.js";
import {
  getAllCustomers,
  getInactiveCustomers,
  getCustomerStats,
} from "./customers.js";
import { SERVICES } from "./knipklok.js";

const SHOP_NAME = process.env.SHOP_NAME || "Kapsalon The Future";
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || "klippr2026";

// Simpele auth middleware — password via query of cookie
export function dashboardAuth(req, res, next) {
  const pw = req.query.pw || req.cookies?.klippr_pw;
  if (pw === DASHBOARD_PASSWORD) {
    if (req.query.pw) {
      res.setHeader(
        "Set-Cookie",
        `klippr_pw=${pw}; Path=/; HttpOnly; Max-Age=604800`
      );
    }
    return next();
  }
  return res.status(401).send(loginPage());
}

function loginPage() {
  return `<!DOCTYPE html>
<html lang="nl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Klippr — Login</title>
<script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-black min-h-screen flex items-center justify-center">
  <form class="bg-neutral-900 p-8 rounded-2xl border border-neutral-800 w-full max-w-sm">
    <div class="text-center mb-6">
      <div class="text-4xl mb-2">💈</div>
      <h1 class="text-3xl font-bold text-white">Klippr</h1>
      <p class="text-neutral-400 text-sm mt-1">Dashboard</p>
    </div>
    <input type="password" name="pw" placeholder="Wachtwoord"
      class="w-full bg-neutral-800 text-white px-4 py-3 rounded-lg border border-neutral-700 focus:outline-none focus:border-yellow-500" />
    <button class="w-full mt-4 bg-yellow-500 hover:bg-yellow-400 text-black font-bold py-3 rounded-lg transition">
      Inloggen
    </button>
  </form>
</body>
</html>`;
}

function layout(title, body, activeTab = "home") {
  const tab = (id, label, icon) => `
    <a href="/dashboard${id === "home" ? "" : "/" + id}"
       class="${
         activeTab === id
           ? "bg-yellow-500 text-black"
           : "text-neutral-400 hover:text-white hover:bg-neutral-800"
       } px-4 py-2 rounded-lg font-medium transition">
      ${icon} ${label}
    </a>`;

  return `<!DOCTYPE html>
<html lang="nl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Klippr — ${title}</title>
<script src="https://cdn.tailwindcss.com"></script>
<meta http-equiv="refresh" content="30">
</head>
<body class="bg-black min-h-screen text-white">
  <nav class="border-b border-neutral-800 bg-neutral-950">
    <div class="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between flex-wrap gap-3">
      <div class="flex items-center gap-3">
        <div class="text-2xl">💈</div>
        <div>
          <div class="font-bold text-xl">Klippr</div>
          <div class="text-xs text-neutral-500">${SHOP_NAME}</div>
        </div>
      </div>
      <div class="flex gap-2 flex-wrap">
        ${tab("home", "Vandaag", "📅")}
        ${tab("bookings", "Afspraken", "📖")}
        ${tab("customers", "Klanten", "👥")}
        ${tab("settings", "Instellingen", "⚙️")}
      </div>
    </div>
  </nav>
  <main class="max-w-6xl mx-auto p-4 md:p-6">
    ${body}
  </main>
  <footer class="text-center text-neutral-600 text-xs py-6">
    Klippr v1.0 · auto-refresh elke 30 sec
  </footer>
</body>
</html>`;
}

function card(title, value, subtitle = "", color = "yellow") {
  const colors = {
    yellow: "text-yellow-400",
    green: "text-green-400",
    red: "text-red-400",
    blue: "text-blue-400",
    white: "text-white",
  };
  return `
    <div class="bg-neutral-900 border border-neutral-800 rounded-2xl p-5">
      <div class="text-neutral-500 text-sm uppercase tracking-wide">${title}</div>
      <div class="text-3xl font-bold mt-2 ${colors[color] || colors.yellow}">${value}</div>
      ${subtitle ? `<div class="text-neutral-400 text-sm mt-1">${subtitle}</div>` : ""}
    </div>`;
}

function calculateRevenue(bookings) {
  return bookings.reduce((sum, b) => {
    const price = SERVICES[b.service]?.price || 0;
    return sum + price;
  }, 0);
}

function formatServiceName(key) {
  return SERVICES[key]?.label || key;
}

// ─────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────
export function mountDashboard(app) {
  // Homepage — vandaag
  app.get("/dashboard", dashboardAuth, (req, res) => {
    const today = getTodaysBookings().sort((a, b) =>
      a.time.localeCompare(b.time)
    );
    const upcoming = getAllUpcoming();
    const weekAhead = upcoming.filter((b) => {
      const ts = new Date(`${b.date}T${b.time}:00`).getTime();
      return ts - Date.now() < 7 * 86400000;
    });
    const stats = getCustomerStats();
    const revenueToday = calculateRevenue(today);

    const now = Date.now();
    const next = today.find((b) => {
      const ts = new Date(`${b.date}T${b.time}:00`).getTime();
      return ts > now;
    });

    const body = `
      <h1 class="text-3xl font-bold mb-6">📅 Vandaag</h1>

      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        ${card("Vandaag", today.length, "afspraken", "yellow")}
        ${card("Omzet vandaag", `€${revenueToday}`, "", "green")}
        ${card("Deze week", weekAhead.length, "afspraken", "blue")}
        ${card("Klanten", stats.total, `${stats.newThisMonth} nieuw deze maand`, "white")}
      </div>

      ${
        next
          ? `
      <div class="bg-yellow-500/10 border border-yellow-500/30 rounded-2xl p-5 mb-6">
        <div class="text-yellow-400 text-sm font-medium uppercase tracking-wide">⏰ Volgende afspraak</div>
        <div class="text-2xl font-bold mt-2">${next.time} — ${next.name}</div>
        <div class="text-neutral-400 text-sm mt-1">
          ${formatServiceName(next.service)}${next.barber && next.barber !== "maakt niet uit" ? ` · ${next.barber}` : ""}
        </div>
      </div>`
          : ""
      }

      <!-- Uitloop knoppen -->
      <div class="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 mb-6">
        <div class="font-bold mb-3">⏱️ Uitloop sturen naar alle klanten van vandaag</div>
        <div class="flex gap-2 flex-wrap">
          ${[5, 10, 15, 20, 30]
            .map(
              (m) => `
            <form method="POST" action="/dashboard/delay?pw=${DASHBOARD_PASSWORD}" class="inline">
              <input type="hidden" name="minutes" value="${m}" />
              <button class="bg-neutral-800 hover:bg-yellow-500 hover:text-black px-5 py-3 rounded-lg font-bold transition">
                +${m} min
              </button>
            </form>`
            )
            .join("")}
        </div>
      </div>

      <!-- Schema vandaag -->
      <div class="bg-neutral-900 border border-neutral-800 rounded-2xl p-5">
        <div class="font-bold mb-4">💈 Schema vandaag</div>
        ${
          today.length === 0
            ? '<div class="text-neutral-500 text-sm">Geen afspraken vandaag</div>'
            : `<div class="space-y-2">
          ${today
            .map((b) => {
              const ts = new Date(`${b.date}T${b.time}:00`).getTime();
              const past = ts < now;
              return `
            <div class="flex items-center gap-4 p-3 rounded-lg ${past ? "bg-neutral-950 opacity-50" : "bg-neutral-800"}">
              <div class="text-xl font-bold w-20">${b.time}</div>
              <div class="flex-1">
                <div class="font-medium">${b.name}</div>
                <div class="text-sm text-neutral-400">
                  ${formatServiceName(b.service)}${b.barber && b.barber !== "maakt niet uit" ? ` · ${b.barber}` : ""}
                </div>
              </div>
              <div class="text-sm text-neutral-500">€${SERVICES[b.service]?.price || 0}</div>
            </div>`;
            })
            .join("")}
        </div>`
        }
      </div>
    `;
    res.send(layout("Vandaag", body, "home"));
  });

  // Afspraken
  app.get("/dashboard/bookings", dashboardAuth, (req, res) => {
    const upcoming = getAllUpcoming().sort((a, b) => {
      return `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`);
    });

    const grouped = {};
    upcoming.forEach((b) => {
      if (!grouped[b.date]) grouped[b.date] = [];
      grouped[b.date].push(b);
    });

    const body = `
      <h1 class="text-3xl font-bold mb-6">📖 Alle afspraken</h1>
      ${
        upcoming.length === 0
          ? '<div class="text-neutral-500">Geen aankomende afspraken</div>'
          : Object.entries(grouped)
              .map(
                ([date, bookings]) => `
        <div class="mb-6">
          <div class="text-yellow-400 font-bold text-lg mb-3">${new Date(date).toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" })}</div>
          <div class="bg-neutral-900 border border-neutral-800 rounded-2xl divide-y divide-neutral-800">
            ${bookings
              .map(
                (b) => `
              <div class="flex items-center gap-4 p-4">
                <div class="text-xl font-bold w-20">${b.time}</div>
                <div class="flex-1">
                  <div class="font-medium">${b.name}</div>
                  <div class="text-sm text-neutral-400">
                    ${formatServiceName(b.service)}${b.barber && b.barber !== "maakt niet uit" ? ` · ${b.barber}` : ""}
                  </div>
                  <div class="text-xs text-neutral-500 mt-1">📱 ${b.phoneNumber || b.phone}</div>
                </div>
                <div class="text-sm text-yellow-400 font-bold">€${SERVICES[b.service]?.price || 0}</div>
              </div>`
              )
              .join("")}
          </div>
        </div>`
              )
              .join("")
      }
    `;
    res.send(layout("Afspraken", body, "bookings"));
  });

  // Klanten
  app.get("/dashboard/customers", dashboardAuth, (req, res) => {
    const customers = getAllCustomers();
    const inactive = getInactiveCustomers(5);
    const stats = getCustomerStats();

    const body = `
      <h1 class="text-3xl font-bold mb-6">👥 Klanten</h1>

      <div class="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
        ${card("Totaal klanten", stats.total, "", "yellow")}
        ${card("Nieuw deze maand", stats.newThisMonth, "", "green")}
        ${card("Niet geweest >5 weken", stats.inactive, "reactivatie kandidaten", "red")}
      </div>

      ${
        inactive.length > 0
          ? `
      <div class="bg-red-500/10 border border-red-500/30 rounded-2xl p-5 mb-6">
        <div class="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div class="text-red-400 font-bold">💤 ${inactive.length} klanten niet geweest &gt;5 weken</div>
            <div class="text-sm text-neutral-400 mt-1">Stuur ze een reactivatie bericht</div>
          </div>
          <form method="POST" action="/dashboard/reactivate?pw=${DASHBOARD_PASSWORD}">
            <button class="bg-red-500 hover:bg-red-400 text-black font-bold px-5 py-3 rounded-lg transition">
              📨 Stuur reactivatie
            </button>
          </form>
        </div>
      </div>`
          : ""
      }

      <div class="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden">
        ${
          customers.length === 0
            ? '<div class="p-5 text-neutral-500 text-sm">Nog geen klanten</div>'
            : `<table class="w-full">
          <thead class="bg-neutral-950 text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th class="text-left p-3">Naam</th>
              <th class="text-left p-3 hidden md:table-cell">Telefoon</th>
              <th class="text-left p-3">Bezoeken</th>
              <th class="text-left p-3 hidden md:table-cell">Favoriete kapper</th>
              <th class="text-left p-3">Laatst</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-neutral-800">
            ${customers
              .map((c) => {
                const daysSince = c.lastBookingDate
                  ? Math.floor(
                      (Date.now() - new Date(c.lastBookingDate).getTime()) /
                        86400000
                    )
                  : null;
                return `
              <tr class="hover:bg-neutral-800/50">
                <td class="p-3 font-medium">${c.name || "—"}</td>
                <td class="p-3 text-sm text-neutral-400 hidden md:table-cell">${c.phone}</td>
                <td class="p-3 text-sm">${c.visitCount || 0}</td>
                <td class="p-3 text-sm text-neutral-400 hidden md:table-cell">${c.favoriteBarber || "—"}</td>
                <td class="p-3 text-sm text-neutral-400">${daysSince !== null ? `${daysSince}d geleden` : "—"}</td>
              </tr>`;
              })
              .join("")}
          </tbody>
        </table>`
        }
      </div>
    `;
    res.send(layout("Klanten", body, "customers"));
  });

  // Settings
  app.get("/dashboard/settings", dashboardAuth, (req, res) => {
    const body = `
      <h1 class="text-3xl font-bold mb-6">⚙️ Instellingen</h1>

      <div class="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 mb-6">
        <div class="font-bold mb-4">🏪 Shop info</div>
        <div class="space-y-3 text-sm">
          <div class="flex justify-between border-b border-neutral-800 pb-2">
            <span class="text-neutral-400">Naam</span>
            <span>${SHOP_NAME}</span>
          </div>
          <div class="flex justify-between border-b border-neutral-800 pb-2">
            <span class="text-neutral-400">WhatsApp nummer</span>
            <span class="text-xs">${process.env.TWILIO_WHATSAPP_FROM || "niet geconfigureerd"}</span>
          </div>
          <div class="flex justify-between border-b border-neutral-800 pb-2">
            <span class="text-neutral-400">Kapper telefoon (uitloop)</span>
            <span class="text-xs">${process.env.BARBER_PHONE || "niet geconfigureerd"}</span>
          </div>
        </div>
      </div>

      <div class="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 mb-6">
        <div class="font-bold mb-4">💈 Diensten &amp; prijzen</div>
        <div class="space-y-2">
          ${Object.entries(SERVICES)
            .map(
              ([key, s]) => `
            <div class="flex justify-between text-sm py-2 border-b border-neutral-800">
              <span>${s.label}</span>
              <span class="text-yellow-400 font-bold">€${s.price}</span>
            </div>`
            )
            .join("")}
        </div>
      </div>

      <div class="bg-neutral-900 border border-neutral-800 rounded-2xl p-5">
        <div class="font-bold mb-2">📊 API endpoints</div>
        <div class="text-xs font-mono text-neutral-400 space-y-1">
          <div>GET /bookings — JSON van alle boekingen</div>
          <div>POST /webhook/twilio — Twilio WhatsApp inbox</div>
          <div>GET /dashboard — dit dashboard</div>
        </div>
      </div>
    `;
    res.send(layout("Instellingen", body, "settings"));
  });
}

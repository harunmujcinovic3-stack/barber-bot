import { chromium } from "playwright";
import path from "path";
import { SCREENSHOTS_DIR } from "./db.js";

const SHOP_URL =
  "https://knipklok.nl/kapperszaak/kapsalon-the-future/afspraak";

// Helper voor persistent screenshot paden
function shotPath(name) {
  return path.join(SCREENSHOTS_DIR, name);
}

export const SERVICES = {
  knippen: { label: "Knippen (30 minuten)", price: 20, duration: 30 },
  knippen_baard: {
    label: "Knippen en baard (30 minuten)",
    price: 25,
    duration: 30,
  },
  knippen_baard_gezicht: {
    label: "Knippen+baard+gezichtsbehandeling (60 minuten)",
    price: 45,
    duration: 60,
  },
  kinderen: {
    label: "Kinderen tot 10jaar (30 minuten)",
    price: 15,
    duration: 30,
  },
  knippen_wassen: {
    label: "Knippen en wassen (30 minuten)",
    price: 25,
    duration: 30,
  },
  baard: { label: "Baard trimmen (10 minuten)", price: 10, duration: 10 },
  gezicht: {
    label: "Gezichtsbehandeling (30 minuten)",
    price: 20,
    duration: 30,
  },
  future_cut: { label: "Future cut (30 minuten)", price: 40, duration: 30 },
};

export const BARBERS = ["Mo", "Anass", "Ayman"];

// Persistente browser
let browserInstance = null;

async function getBrowser() {
  if (browserInstance && browserInstance.isConnected()) return browserInstance;
  browserInstance = await chromium.launch({
    headless: true,
    args: ["--disable-dev-shm-usage", "--no-sandbox"],
  });
  return browserInstance;
}

export async function closeBrowser() {
  if (browserInstance) {
    await browserInstance.close().catch(() => {});
    browserInstance = null;
  }
}

// Datum parsing
const DAYS_NL = {
  maandag: 1, dinsdag: 2, woensdag: 3, donderdag: 4,
  vrijdag: 5, zaterdag: 6, zondag: 0,
};

function resolveWhen(when) {
  let w = String(when || "morgen").toLowerCase().trim();
  // Strip "april", "maart" etc — we klikken gewoon op dagnummer
  w = w.replace(/\b(januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december)\b/g, "").trim();

  const now = new Date();

  if (w === "vandaag") return { label: "Vandaag", dayNum: now.getDate() };
  if (w === "morgen") {
    const t = new Date(now.getTime() + 86400000);
    return { label: "Morgen", dayNum: t.getDate() };
  }

  if (DAYS_NL[w] !== undefined) {
    const target = DAYS_NL[w];
    if (target === 0)
      return { closed: true, reason: "Op zondag zijn we gesloten bro 🙏" };
    const today = now.getDay();
    let diff = (target - today + 7) % 7;
    if (diff === 0) diff = 7;
    const t = new Date(now.getTime() + diff * 86400000);
    return { label: null, dayNum: t.getDate() };
  }

  // Getal extraheren uit bv "22" of "22 april"
  const numMatch = w.match(/\d+/);
  if (numMatch) return { label: null, dayNum: parseInt(numMatch[0]) };

  // Fallback
  const t = new Date(now.getTime() + 86400000);
  return { label: "Morgen", dayNum: t.getDate() };
}

// Navigatie naar het tijden-scherm
async function openBookingPage({ barber, service, when }) {
  const browser = await getBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(SHOP_URL, { waitUntil: "domcontentloaded", timeout: 20000 });

  const barberTarget =
    barber && BARBERS.includes(barber) ? barber : "Maakt niet uit";
  await page.waitForSelector(`text=${barberTarget}`, { timeout: 10000 });
  await page.click(`text=${barberTarget}`);

  const s = SERVICES[service];
  if (!s) {
    await context.close();
    throw new Error(`Onbekende service: ${service}`);
  }
  await page.waitForSelector(`text=${s.label}`, { timeout: 10000 });
  await page.click(`text=${s.label}`);

  const resolved = resolveWhen(when);
  if (resolved.closed) {
    await context.close();
    return { closed: true, reason: resolved.reason };
  }

  await page.waitForTimeout(1500);

  if (resolved.label === "Vandaag" || resolved.label === "Morgen") {
    await page.click(`text=${resolved.label}`);
  } else if (resolved.dayNum) {
    try {
      await page.click(`a:text-is("${resolved.dayNum}")`, { timeout: 5000 });
    } catch (e) {
      await page.click("text=Morgen");
    }
  }

  await page.waitForTimeout(1800);
  return { page, context };
}

// Helper: lees alle tijden van de huidige pagina
async function readSlots(page) {
  return await page.$$eval("a, button, li, div", (els) =>
    [
      ...new Set(
        els
          .map((e) => e.innerText?.trim())
          .filter((t) => t && /^\d{1,2}:\d{2}$/.test(t))
      ),
    ]
  );
}

// ─────────────────────────────────────────────────────────────
// Check beschikbaarheid
// ─────────────────────────────────────────────────────────────
export async function checkAvailability({
  service,
  when = "morgen",
  barber = null,
} = {}) {
  let result;
  try {
    result = await openBookingPage({ barber, service, when });
  } catch (err) {
    return { success: false, error: err.message };
  }

  if (result.closed) {
    return { success: true, closed: true, reason: result.reason, slots: [] };
  }

  const { page, context } = result;
  try {
    const slots = await readSlots(page);
    return {
      success: true,
      slots,
      barber: barber || "maakt niet uit",
      service: SERVICES[service]?.label,
      note: slots.length === 0
        ? "Geen tijden beschikbaar op die dag"
        : `Deze tijden zijn beschikbaar: ${slots.join(", ")}. Gebruik ALLEEN deze tijden, verzin er geen.`,
    };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    await context.close().catch(() => {});
  }
}

// ─────────────────────────────────────────────────────────────
// Boek een afspraak
// ─────────────────────────────────────────────────────────────
export async function bookAppointment({
  service,
  when,
  time,
  barber,
  name,
  email,
  phone,
}) {
  let result;
  try {
    result = await openBookingPage({ barber, service, when });
  } catch (err) {
    return { success: false, error: err.message };
  }

  if (result.closed) {
    return { success: false, error: result.reason };
  }

  const { page, context } = result;
  try {
    // Check eerst of de tijd bestaat
    const availableSlots = await readSlots(page);
    if (!availableSlots.includes(time)) {
      await context.close().catch(() => {});
      return {
        success: false,
        error: `De tijd ${time} is niet beschikbaar`,
        availableSlots,
        message: `De tijd ${time} bestaat niet voor deze kapper/dag. Beschikbare tijden: ${availableSlots.join(", ")}`,
      };
    }

    // Klik op de tijd
    await page.click(`text=${time}`, { timeout: 8000 });
    await page.waitForTimeout(1500);

    // Check of we op het formulier scherm zijn
    const nameVisible = await page.$("#name").catch(() => null);
    if (!nameVisible) {
      await context.close().catch(() => {});
      return {
        success: false,
        error: `Kon niet doorgaan naar het formulier na tijd klikken`,
      };
    }

    // Naam split fix — Knipklok wil misschien voor- en achternaam
    let fullName = (name || "Klant").trim();
    if (!fullName.includes(" ")) {
      fullName = `${fullName} ${fullName}`; // fallback: voornaam = achternaam
    }

    await page.fill("#name", fullName);
    await page.fill("#phone", phone || "0600000000");
    await page.fill("#email", email || "noreply@example.com");
    await page.waitForTimeout(500);

    // Volgende
    await page.click('button:text-is("Volgende"):visible', { timeout: 5000 });
    await page.waitForTimeout(2500);

    // Screenshot samenvatting
    const summaryShot = `booking-summary-${Date.now()}.png`;
    await page.screenshot({ path: shotPath(summaryShot), fullPage: true });

    // Afspraak maken — robuuste click
    try {
      // Methode 1: scroll naar knop en klik
      const confirmBtn = await page.locator('button:has-text("Afspraak maken")').first();
      await confirmBtn.scrollIntoViewIfNeeded();
      await confirmBtn.click({ timeout: 8000 });
    } catch (e1) {
      console.log("[knipklok] normal click failed, trying force...");
      try {
        await page
          .locator('button:has-text("Afspraak maken")')
          .first()
          .click({ force: true, timeout: 5000 });
      } catch (e2) {
        // Methode 3: JavaScript click
        const clicked = await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll("button"));
          const target = btns.find((b) => b.innerText?.includes("Afspraak maken"));
          if (target) {
            target.click();
            return true;
          }
          return false;
        });
        if (!clicked) {
          await context.close().catch(() => {});
          return {
            success: false,
            error: "Kon de bevestigingsknop niet klikken",
          };
        }
      }
    }

    await page.waitForTimeout(4000);

    const finalText = await page.evaluate(() => document.body.innerText);
    const success = /bevestigd|succesvol|bedankt|gemaakt|ingepland/i.test(
      finalText
    );

    const resultShot = `booking-result-${Date.now()}.png`;
    await page.screenshot({ path: shotPath(resultShot), fullPage: true });

    return {
      success,
      screenshot: resultShot,
      summary: summaryShot,
      pageText: finalText.slice(0, 300),
    };
  } catch (err) {
    console.error("[knipklok] book error:", err.message);
    try {
      await page.screenshot({ path: shotPath(`booking-error-${Date.now()}.png`) });
    } catch {}
    return { success: false, error: err.message };
  } finally {
    await context.close().catch(() => {});
  }
}

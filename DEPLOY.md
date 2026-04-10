# 🚀 Klippr Deploy Guide

Deze gids brengt Klippr van je laptop naar 24/7 productie op Railway. Volg dit in volgorde, van boven naar beneden.

---

## ✅ Voordat je begint

Zorg dat je hebt:
- [ ] Een GitHub account
- [ ] Een Railway account → https://railway.app (gratis, 500 uur/maand)
- [ ] Een Better Stack account → https://betterstack.com (gratis, voor uptime monitoring)
- [ ] Al je API keys in een aparte notitie (OpenAI, Twilio, etc.)

---

## STAP 1 — Push naar GitHub (10 min)

```bash
cd /Users/harunmujcinovic/Desktop/jahajah

# Als je nog geen git repo hebt:
git init
git add .
git commit -m "Klippr v1.0 — production ready"

# Maak een private repo op github.com (belangrijk: PRIVATE!)
# Naam: klippr
# Niet toevoegen: README, .gitignore, license

# Koppel en push
git remote add origin https://github.com/JOUW_USERNAME/klippr.git
git branch -M main
git push -u origin main
```

⚠️ **CHECK**: open je repo op GitHub → zorg dat `.env` NIET in de repo staat. Alleen `.env.example`.

---

## STAP 2 — Railway project aanmaken (5 min)

1. Ga naar https://railway.app/new
2. Klik **"Deploy from GitHub repo"**
3. Autoriseer Railway voor je GitHub (alleen de Klippr repo)
4. Selecteer **klippr** repo
5. Railway detecteert automatisch de `Dockerfile` en begint te builden

Eerste build duurt ~3-5 minuten (Playwright image downloaden).

---

## STAP 3 — Persistent Volume toevoegen (KRITIEK!) (3 min)

Dit is wat voorkomt dat je data verliest bij elke redeploy.

1. In je Railway project → klik op de service
2. Ga naar **Settings** → scroll naar **Volumes**
3. Klik **+ New Volume**
4. Mount path: `/data`
5. Klik **Add**

De service start opnieuw. Vanaf nu leeft je `klippr.db` + screenshots in `/data` en overleeft elke deploy.

---

## STAP 4 — Environment variables (5 min)

In je Railway service → **Variables** tab → voeg toe:

| Key | Value |
|---|---|
| `OPENAI_API_KEY` | je OpenAI key (begint met `sk-proj-`) |
| `TWILIO_ACCOUNT_SID` | van twilio.com → Console |
| `TWILIO_AUTH_TOKEN` | van twilio.com → Console |
| `TWILIO_WHATSAPP_FROM` | `whatsapp:+14155238886` (sandbox) of je prod nummer |
| `SHOP_NAME` | `Kapsalon The Future` |
| `BARBER_PHONE` | `whatsapp:+31...` (voor uitloop + error alerts) |
| `DASHBOARD_PASSWORD` | kies een sterk wachtwoord |
| `DATA_DIR` | `/data` |
| `NODE_ENV` | `production` |

Klik **Deploy** (of het redeployed automatisch).

---

## STAP 5 — Public URL koppelen (2 min)

1. Railway service → **Settings** → **Networking**
2. Klik **Generate Domain** onder "Public Networking"
3. Je krijgt een URL zoals: `klippr-production-abcd.up.railway.app`
4. Kopieer deze URL

Test in je browser:
- `https://JOUW-URL/` → moet tonen: *"Klippr 💈 — bot is live 🔥"*
- `https://JOUW-URL/health` → moet JSON met status=ok tonen
- `https://JOUW-URL/dashboard?pw=JOUW_WACHTWOORD` → dashboard

---

## STAP 6 — Twilio webhook updaten (2 min)

De bot moet nu via de Railway URL luisteren, niet meer via ngrok/localhost.

1. Ga naar https://console.twilio.com → **Messaging** → **Try it out** → **Send a WhatsApp message** → **Sandbox settings**
2. Bij **"When a message comes in"**:
   ```
   https://JOUW-URL/webhook/twilio
   ```
3. Method: **POST**
4. Klik **Save**

---

## STAP 7 — Live test (2 min)

Stuur vanaf je WhatsApp naar het sandbox nummer:
```
joo bro
```

Je moet binnen 3-5 seconden een reply krijgen van Klippr. Als dat werkt: **je bot draait in de cloud, 24/7, onafhankelijk van jouw laptop.** 🔥

---

## STAP 8 — Uptime monitoring (5 min)

Dit zorgt dat jij een SMS krijgt als de bot down gaat.

1. Ga naar https://betterstack.com/uptime → maak gratis account
2. **Monitors** → **+ New Monitor**
3. Type: **HTTP / Website**
4. URL: `https://JOUW-URL/health`
5. Check frequency: **3 minutes** (free tier)
6. Keywords to find: `ok` (in response body)
7. Notifications: voeg je telefoon + email toe
8. Klik **Create monitor**

Nu krijg je een melding binnen 3 min als Klippr down gaat. Combineer met Railway's auto-restart → je bot is praktisch altijd beschikbaar.

---

## 🎯 WAT JE NU HEBT

- ✅ Klippr draait 24/7 op Railway
- ✅ Persistent SQLite database op `/data` volume — overleeft restarts
- ✅ Auto-restart bij crashes (max 10 retries)
- ✅ Health endpoint voor monitoring
- ✅ Error alerts direct naar jouw WhatsApp bij crashes
- ✅ Uptime monitoring via Better Stack
- ✅ Dashboard bereikbaar op `https://JOUW-URL/dashboard`
- ✅ Screenshots persistent opgeslagen

**Je bent live bro.** 💈

---

## 🔧 Dingen die je moet weten

### Hoe deploy je updates?
```bash
git add .
git commit -m "beschrijving"
git push
```
Railway pakt de push automatisch op en deployed.

### Hoe bekijk je logs?
Railway service → **Deployments** → klik op de actieve deploy → logs tab.

### Hoe zie je je database?
Makkelijkste manier:
1. Railway service → **Settings** → download volume backup
2. Open met een SQLite client zoals [DB Browser for SQLite](https://sqlitebrowser.org/)

Of gewoon: `https://JOUW-URL/dashboard` laat alles visueel zien.

### Kosten schatting
- **Railway**: Gratis tot $5/maand gebruik. Verwacht: ~$3-5/maand voor 1 bot die permanent draait.
- **Twilio WhatsApp**: Sandbox is gratis. Production nummer: ~$1/maand + $0.005 per bericht.
- **OpenAI**: gpt-4o-mini = ~$0.001 per gesprek. 100 gesprekken/dag = ~$3/maand.
- **Better Stack**: Gratis.
- **Totaal**: ~$10-15/maand voor 1 shop.

Bij €99/maand per shop → **€84+ marge** per shop. Scale dat.

### Backup van je data
Railway volume backup:
- Railway service → **Settings** → **Backup Volume** (handmatig)
- Of SSH in via Railway CLI: `railway shell` → `cp /data/klippr.db /tmp/`

Zet een reminder om dit maandelijks te doen tot we een auto-backup bouwen.

### Iets stuk? Rollback
Railway service → **Deployments** → klik op een oudere groene deploy → **Redeploy**.

---

## 🚨 Wat te doen als het niet werkt

### Bot reageert niet op WhatsApp
1. Check Railway logs → staan er errors?
2. Check `https://JOUW-URL/health` → status=ok?
3. Check Twilio webhook URL → is `https://JOUW-URL/webhook/twilio`?
4. Check Railway Variables → zijn `TWILIO_*` en `OPENAI_API_KEY` gezet?

### Build faalt
Meest voorkomende oorzaak: Playwright versie mismatch.
- Check `package.json`: `"playwright": "^1.59.1"`
- Check `Dockerfile`: `FROM mcr.microsoft.com/playwright:v1.59.1-noble`
- Beide versies moeten matchen.

### Database error
- Check of de Volume gemount is op `/data`
- Check of `DATA_DIR=/data` in Variables staat
- Logs moeten tonen: `[db] opening /data/klippr.db`

### Dashboard login werkt niet
- Check `DASHBOARD_PASSWORD` in Variables
- Gebruik `?pw=...` achter de URL bij eerste bezoek

---

## 📞 Support

Stuk? Vraag je AI co-founder (ik) met de Railway logs als context.

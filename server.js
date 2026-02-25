const express = require("express");
const twilio = require("twilio");
const { google } = require("googleapis");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

/* ================= GOOGLE OAUTH ================= */

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

oauth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
});

/* ================= GOOGLE EVENT ================= */

async function createGoogleEvent(summary, start, end) {
  const calendar = google.calendar({ version: "v3", auth: oauth2Client });

  const event = {
    summary,
    start: { dateTime: start, timeZone: "Europe/Paris" },
    end: { dateTime: end, timeZone: "Europe/Paris" },
  };

  const response = await calendar.events.insert({
    calendarId: "primary",
    resource: event,
  });

  return response.data.htmlLink;
}

/* ================= ROUTE TEST ================= */

app.get("/", (req, res) => {
  res.send("Serveur actif ✅");
});

/* ================= CREATE EVENT TEST ================= */

app.get("/create-event", async (req, res) => {
  try {
    const link = await createGoogleEvent(
      "Test RDV IA",
      "2026-02-20T10:00:00",
      "2026-02-20T10:30:00"
    );

    res.send("✅ Événement créé : " + link);
  } catch (error) {
    console.error(error);
    res.send("❌ Erreur création événement");
  }
});

/* ================= TWILIO SMS ================= */

app.post("/sms", (req, res) => {
  console.log("SMS reçu :", req.body.Body);

  res.type("text/xml");
  res.send(`
<Response>
  <Message>Message bien reçu 👌</Message>
</Response>
  `);
});

/* ================= TWILIO VOICE ================= */

app.post("/voice", (req, res) => {
  console.log("📞 Appel reçu");

  res.type("text/xml");
  res.send(`
<Response>
  <Say voice="alice" language="fr-FR">
    Bonjour, ceci est un test vocal.
  </Say>
</Response>
  `);
});

/* ================= START SERVER ================= */

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});

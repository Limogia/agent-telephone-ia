const express = require("express");
const twilio = require("twilio");
const { google } = require("googleapis");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// ================= GOOGLE OAUTH =================

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

oauth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
});

// Route test serveur
app.get("/", (req, res) => {
  res.send("Serveur actif ✅");
});

// ================= GOOGLE CALENDAR =================

app.get("/create-event", async (req, res) => {
  try {
    const calendar = google.calendar({ version: "v3", auth: oauth2Client });

    const event = {
      summary: "Test RDV IA",
      description: "Rendez-vous créé automatiquement par ton agent IA",
      start: {
        dateTime: "2026-02-20T10:00:00",
        timeZone: "Europe/Paris",
      },
      end: {
        dateTime: "2026-02-20T10:30:00",
        timeZone: "Europe/Paris",
      },
    };

    const response = await calendar.events.insert({
      calendarId: "primary",
      resource: event,
    });

    res.send("✅ Événement créé : " + response.data.htmlLink);
  } catch (error) {
    console.error(error);
    res.send("❌ Erreur création événement");
  }
});

// ================= TWILIO =================

// Réception SMS
app.post("/sms", (req, res) => {
  console.log("SMS reçu :", req.body.Body);

  res.set("Content-Type", "text/xml");
  res.send(`
    <Response>
      <Message>Message bien reçu 👌</Message>
    </Response>
  `);
});

// Envoi SMS test DIRECT (sans Messaging Service)
app.get("/send-test-sms", async (req, res) => {
  try {
    const client = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );

    await client.messages.create({
      body: "Test SMS direct 🚀",
      from: "+12566735963",   // TON numéro Twilio
      to: "+33664248605"      // TON numéro perso vérifié
    });

    res.send("SMS envoyé !");
  } catch (error) {
    console.error(error);
    res.send("Erreur envoi SMS");
  }
});

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});

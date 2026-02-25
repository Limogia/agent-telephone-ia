const express = require("express");
const { google } = require("googleapis");
const OpenAI = require("openai");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// ================= OPENAI =================
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ================= GOOGLE OAUTH =================
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

oauth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
});

// ================= GOOGLE EVENT CREATION =================
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

// ================= TWILIO VOICE =================
app.post("/voice", async (req, res) => {
  console.log("📞 Appel reçu de Twilio");

  res.type("text/xml");
  res.send(`
<Response>
  <Say voice="alice" language="fr-FR">
    Bonjour, ceci est un test vocal.
  </Say>
</Response>
  `);
});

// ================= ROOT =================
app.get("/", (req, res) => {
  res.send("Serveur actif ✅");
});

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});

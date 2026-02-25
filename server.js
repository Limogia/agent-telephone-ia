{
  "name": "agent-telephone-ia",
  "version": "1.0.0",
  "description": "",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "googleapis": "^128.0.0",
    "twilio": "^4.0.0"
  }
}

m 


const express = require("express"); const twilio = require("twilio"); const { google } = require("googleapis"); const app = express(); const PORT = process.env.PORT || 3000; app.use(express.json()); app.use(express.urlencoded({ extended: false })); // ================= GOOGLE OAUTH ================= // Configuration OAuth Google const oauth2Client = new google.auth.OAuth2( process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI ); // Injection automatique du refresh token oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN, }); // Route test app.get("/", (req, res) => { res.send("Serveur actif ✅"); }); // Route connexion Google (utile si tu veux reconnecter) app.get("/auth/google", (req, res) => { const url = oauth2Client.generateAuthUrl({ access_type: "offline", prompt: "consent", scope: ["https://www.googleapis.com/auth/calendar"], }); res.redirect(url); }); // Callback Google app.get("/auth/google/callback", async (req, res) => { try { const code = req.query.code; const { tokens } = await oauth2Client.getToken(code); console.log("REFRESH TOKEN:", tokens.refresh_token); res.send("Google Calendar connecté ✅ Regarde les logs Railway."); } catch (error) { console.error(error); res.send("Erreur connexion Google"); } }); // ================= GOOGLE CALENDAR ================= // Route pour créer un événement test app.get("/create-event", async (req, res) => { try { const calendar = google.calendar({ version: "v3", auth: oauth2Client }); const event = { summary: "Test RDV IA", description: "Rendez-vous créé automatiquement par ton agent IA", start: { dateTime: "2026-02-20T10:00:00", timeZone: "Europe/Paris", }, end: { dateTime: "2026-02-20T10:30:00", timeZone: "Europe/Paris", }, }; const response = await calendar.events.insert({ calendarId: "primary", resource: event, }); res.send("✅ Événement créé : " + response.data.htmlLink); } catch (error) { console.error(error); res.send("❌ Erreur création événement"); } }); // ================= TWILIO SMS ================= // Route SMS Twilio app.post("/sms", (req, res) => { console.log("SMS reçu :", req.body.Body); res.set("Content-Type", "text/xml"); res.send( <Response> <Message>Message bien reçu ?</Message> </Response> ); }); // Route envoi SMS test app.get("/send-test-sms", async (req, res) => { try { const client = twilio( process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN ); await client.messages.create({ body: "Test SMS depuis Limogia ?", messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID, to: "+33664248605" }); res.send("SMS envoyé !"); } catch (error) { console.error(error); res.send("Erreur envoi SMS"); } }); app.listen(PORT, () => { console.log("Server running on port " + PORT); });

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

const express = require("express");
const twilio = require("twilio");
const { google } = require("googleapis");
const OpenAI = require("openai");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

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

// Injection automatique du refresh token
oauth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
});

// ================= ROUTE TEST =================
app.get("/", (req, res) => {
  res.send("Serveur actif ✅");
});

// ================= GOOGLE AUTH (reconnexion si besoin) =================
app.get("/auth/google", (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/calendar"],
  });

  res.redirect(url);
});

app.get("/auth/google/callback", async (req, res) => {
  try {
    const code = req.query.code;
    const { tokens } = await oauth2Client.getToken(code);

    console.log("REFRESH TOKEN:", tokens.refresh_token);

    res.send("Google Calendar connecté ✅ Regarde les logs Railway.");
  } catch (error) {
    console.error(error);
    res.send("Erreur connexion Google");
  }
});

// ================= GOOGLE CALENDAR FIXE =================
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

// ================= FONCTION DYNAMIQUE =================
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

// ================= SIMULATION APPEL =================
app.post("/simulate-call", async (req, res) => {
  try {
    const { message } = req.body;

    const aiResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "Tu extrais une date et heure d'une phrase. Tu réponds uniquement en JSON avec summary, start et end en format ISO.",
        },
        { role: "user", content: message },
      ],
    });

    const parsed = JSON.parse(aiResponse.choices[0].message.content);

    const link = await createGoogleEvent(
      parsed.summary,
      parsed.start,
      parsed.end
    );

    res.json({
      success: true,
      eventLink: link,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false });
  }
});

// ================= TWILIO SMS =================
app.post("/sms", (req, res) => {
  console.log("SMS reçu :", req.body.Body);

  res.set("Content-Type", "text/xml");
  res.send(`
<Response>
  <Message>Message bien reçu 👌</Message>
</Response>
  `);
});

// ================= ENVOI SMS TEST =================
app.get("/send-test-sms", async (req, res) => {
  try {
    const client = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );

    await client.messages.create({
      body: "Test SMS depuis Limogia 🚀",
      messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
      to: "+33664248605",
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

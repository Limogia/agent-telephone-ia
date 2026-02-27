const express = require("express");
const { google } = require("googleapis");
const OpenAI = require("openai");

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

/* =========================
   OPENAI CONFIG
========================= */

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/* =========================
   GOOGLE OAUTH CONFIG
========================= */

const oAuth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

oAuth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
});

const calendar = google.calendar({
  version: "v3",
  auth: oAuth2Client,
});

/* =========================
   ROUTES
========================= */

app.get("/", (req, res) => {
  res.send("Serveur actif ✅");
});

/* ========= ÉTAPE 1 : ÉCOUTER ========= */

app.post("/voice", (req, res) => {
  res.type("text/xml");
  res.send(`
    <Response>
      <Gather input="speech" language="fr-FR" action="/process-speech" method="POST">
        <Say voice="Polly.Celine-Neural" language="fr-FR">
          Bonjour. Quel jour souhaitez-vous un rendez-vous ?
        </Say>
      </Gather>
    </Response>
  `);
});

/* ========= ÉTAPE 2 : IA + GOOGLE ========= */

app.post("/process-speech", async (req, res) => {
  const speech = req.body.SpeechResult || "";

  try {

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "Transforme la demande en JSON strict avec date ISO et heure format 24h. Exemple : {\"date\":\"2026-03-02\",\"time\":\"15:00\"}",
        },
        { role: "user", content: speech },
      ],
    });

    const aiText = completion.choices[0].message.content.trim();
    const parsed = JSON.parse(aiText);

    const startDateTime = new Date(`${parsed.date}T${parsed.time}:00`);

    await calendar.events.insert({
      calendarId: "primary",
      resource: {
        summary: "Rendez-vous client",
        start: {
          dateTime: startDateTime.toISOString(),
          timeZone: "Europe/Paris",
        },
        end: {
          dateTime: new Date(startDateTime.getTime() + 60 * 60 * 1000).toISOString(),
          timeZone: "Europe/Paris",
        },
      },
    });

    res.type("text/xml");
    res.send(`
      <Response>
        <Say voice="Polly.Celine-Neural" language="fr-FR">
          Votre rendez-vous est confirmé.
        </Say>
      </Response>
    `);

  } catch (error) {
    console.error("Erreur IA :", error);

    res.type("text/xml");
    res.send(`
      <Response>
        <Gather input="speech" language="fr-FR" action="/process-speech" method="POST">
          <Say voice="Polly.Celine-Neural" language="fr-FR">
            Je n'ai pas compris la date. Pouvez-vous répéter s'il vous plaît ?
          </Say>
        </Gather>
      </Response>
    `);
  }
});

/* =========================
   SERVER
========================= */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Serveur démarré sur le port " + PORT);
});

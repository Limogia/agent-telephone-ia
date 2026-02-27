const express = require("express");
const { google } = require("googleapis");
const OpenAI = require("openai");

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

/* =========================
   OPENAI
========================= */

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/* =========================
   GOOGLE CALENDAR
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
   MÉMOIRE CONVERSATION
========================= */

const conversations = {};

/* =========================
   ROUTES
========================= */

app.get("/", (req, res) => {
  res.send("Serveur actif ✅");
});

/* ========= DÉMARRAGE ========= */

app.post("/voice", (req, res) => {
  const callSid = req.body.CallSid;

  conversations[callSid] = [
    {
      role: "system",
      content: `
Tu es une assistante téléphonique professionnelle.
Tu parles uniquement en français naturel.

Tu dois TOUJOURS répondre en JSON strict avec ce format :

{
  "reply": "texte naturel à dire",
  "create_event": true ou false,
  "date": "YYYY-MM-DD ou null",
  "time": "HH:MM ou null"
}

Si l'utilisateur donne une date et une heure claire → create_event = true.
Sinon → false.
Ne mets rien en dehors du JSON.
`,
    },
  ];

  res.type("text/xml");
  res.send(`
    <Response>
      <Gather input="speech" language="fr-FR" action="/process-speech" method="POST">
        <Say voice="Polly.Celine-Neural" language="fr-FR">
          Bonjour, comment puis-je vous aider aujourd'hui ?
        </Say>
      </Gather>
    </Response>
  `);
});

/* ========= CONVERSATION ========= */

app.post("/process-speech", async (req, res) => {
  const speech = req.body.SpeechResult || "";
  const callSid = req.body.CallSid;

  conversations[callSid].push({
    role: "user",
    content: speech,
  });

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: conversations[callSid],
    });

    const raw = completion.choices[0].message.content.trim();
    const data = JSON.parse(raw);

    conversations[callSid].push({
      role: "assistant",
      content: data.reply,
    });

    /* ===== SI RENDEZ-VOUS ===== */

    if (data.create_event && data.date && data.time) {
      const startDateTime = new Date(`${data.date}T${data.time}:00`);

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
    }

    res.type("text/xml");
    res.send(`
      <Response>
        <Gather input="speech" language="fr-FR" action="/process-speech" method="POST">
          <Say voice="Polly.Celine-Neural" language="fr-FR">
            ${data.reply}
          </Say>
        </Gather>
      </Response>
    `);

  } catch (error) {
    console.error("Erreur :", error);

    res.type("text/xml");
    res.send(`
      <Response>
        <Say voice="Polly.Celine-Neural" language="fr-FR">
          Désolé, je n'ai pas bien compris. Pouvez-vous reformuler ?
        </Say>
        <Gather input="speech" language="fr-FR" action="/process-speech" method="POST"/>
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

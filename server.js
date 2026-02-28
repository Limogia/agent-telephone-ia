const express = require("express");
const { google } = require("googleapis");
const OpenAI = require("openai");

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

/* ================= OPENAI ================= */

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/* ================= GOOGLE ================= */

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

/* ================= MEMOIRE ================= */

const conversations = {};

/* ================= UTIL ================= */

function escapeXml(text) {
  if (!text || typeof text !== "string") return "Je vous écoute.";
  return text
    .replace(/&/g, "et")
    .replace(/</g, "")
    .replace(/>/g, "")
    .replace(/"/g, "")
    .replace(/'/g, "")
    .trim();
}

function buildTwiML(message) {
  message = escapeXml(message);
  if (!message || message.length < 2) message = "Très bien.";

  return `
<Response>
  <Gather input="speech" timeout="8" speechTimeout="auto" language="fr-FR" action="/process-speech" method="POST">
    <Say language="fr-FR">
      ${message}
    </Say>
  </Gather>
</Response>
`;
}

function resolveYear(dateStr) {
  const today = new Date();
  const [year, month, day] = dateStr.split("-");

  if (!year || year.length < 4) {
    let resolvedYear = today.getFullYear();
    const testDate = new Date(`${resolvedYear}-${month}-${day}`);

    if (testDate < today) {
      resolvedYear += 1;
    }

    return `${resolvedYear}-${month}-${day}`;
  }

  return dateStr;
}

/* ================= ROUTE TEST ================= */

app.get("/", (req, res) => {
  res.send("Serveur actif");
});

/* ================= APPEL INITIAL ================= */

app.post("/voice", (req, res) => {
  const callSid = req.body.CallSid;

  conversations[callSid] = [
    {
      role: "system",
      content: `
Tu es une assistante téléphonique française naturelle et professionnelle.

Règles :
- Si l’année n’est pas précisée, suppose l’année en cours.
- Si la date est passée, utilise l’année suivante.
- En cas de doute, demande une précision.
- Si un rendez-vous est modifié, supprime l’ancien automatiquement.
- Ne lis jamais les balises.

Actions possibles :

[CREATE date="YYYY-MM-DD" time="HH:MM"]
[DELETE date="YYYY-MM-DD" time="HH:MM"]
[CHECK date="YYYY-MM-DD" time="HH:MM"]
`,
    },
  ];

  res.type("text/xml");
  res.send(buildTwiML("Bonjour, comment puis-je vous aider ?"));
});

/* ================= TRAITEMENT ================= */

app.post("/process-speech", async (req, res) => {
  const speech = (req.body.SpeechResult || "").trim();
  const callSid = req.body.CallSid;

  if (!speech) {
    res.type("text/xml");
    return res.send(buildTwiML("Je ne vous ai pas entendu, pouvez-vous répéter ?"));
  }

  if (!conversations[callSid]) conversations[callSid] = [];

  conversations[callSid].push({ role: "user", content: speech });

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: conversations[callSid],
    });

    let reply =
      completion?.choices?.[0]?.message?.content ||
      "Je n'ai pas compris votre demande.";

    /* ================= CREATE ================= */

    const createMatch = reply.match(/\[CREATE date="([^"]+)" time="([^"]+)"\]/);

    if (createMatch) {
      let date = resolveYear(createMatch[1]);
      const time = createMatch[2];

      const startDateTime = `${date}T${time}:00`;
      const endDate = new Date(startDateTime);
      const endDateTime = new Date(endDate.getTime() + 60 * 60 * 1000);

      try {

        // Supprime ancien RDV proche (modification automatique)
        const existingEvents = await calendar.events.list({
          calendarId: "primary",
          timeMin: new Date(endDate.getTime() - 2 * 60 * 60 * 1000).toISOString(),
          timeMax: new Date(endDate.getTime() + 2 * 60 * 60 * 1000).toISOString(),
        });

        for (const event of existingEvents.data.items) {
          await calendar.events.delete({
            calendarId: "primary",
            eventId: event.id,
          });
        }

        await calendar.events.insert({
          calendarId: "primary",
          resource: {
            summary: "Rendez-vous client",
            start: {
              dateTime: startDateTime,
              timeZone: "Europe/Paris",
            },
            end: {
              dateTime: endDateTime.toISOString(),
              timeZone: "Europe/Paris",
            },
          },
        });

        reply = "Votre rendez-vous est confirmé.";
      } catch (calendarError) {
        console.error("ERREUR GOOGLE CREATE :", calendarError.response?.data || calendarError.message);
        reply = "Un problème est survenu lors de la réservation.";
      }
    }

    reply = reply.replace(/\[.*?\]/g, "").trim();

    conversations[callSid].push({ role: "assistant", content: reply });

    res.type("text/xml");
    res.send(buildTwiML(reply));

  } catch (error) {
    console.error("ERREUR OPENAI:", error.message);

    res.type("text/xml");
    res.send(buildTwiML("Une erreur technique est survenue."));
  }
});

/* ================= SERVER ================= */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Serveur démarré sur le port " + PORT);
});

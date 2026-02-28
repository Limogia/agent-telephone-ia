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
const lastCreatedEvent = {};

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
  <Gather input="speech"
          timeout="8"
          speechTimeout="auto"
          language="fr-FR"
          action="/process-speech"
          method="POST">
    <Say language="fr-FR">${message}</Say>
  </Gather>
</Response>
`;
}

/* ================= ROUTE TEST ================= */

app.get("/", (req, res) => {
  res.send("Serveur actif");
});

/* ================= APPEL INITIAL ================= */

app.post("/voice", (req, res) => {
  const callSid = req.body.CallSid;
  const today = new Date().toISOString().split("T")[0];

  conversations[callSid] = [
    {
      role: "system",
      content: `
Tu es une assistante téléphonique française naturelle et professionnelle.

Date actuelle : ${today}

Règles :
- Format exact : YYYY-MM-DD.
- Si année absente, utilise l’année en cours.
- Si date passée cette année, utilise l’année suivante.

[CREATE date="YYYY-MM-DD" time="HH:MM"]
[DELETE date="YYYY-MM-DD" time="HH:MM"]
[CHECK date="YYYY-MM-DD" time="HH:MM"]

Ne lis jamais les balises.
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
      model: "gpt-4o-mini", // modèle plus rapide
      messages: conversations[callSid],
    });

    let reply =
      completion?.choices?.[0]?.message?.content ||
      "Je n'ai pas compris.";

    /* ================= CREATE ================= */

    const createMatch = reply.match(/\[CREATE date="([^"]+)" time="([^"]+)"\]/);

    if (createMatch) {
      let date = createMatch[1];
      const time = createMatch[2];
      const now = new Date();

      // Correction année UNIQUEMENT si absente
      if (date.split("-").length === 2) {
        const [month, day] = date.split("-");
        let year = now.getFullYear();

        const todayOnly = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate()
        );

        const candidate = new Date(
          year,
          parseInt(month) - 1,
          parseInt(day)
        );

        if (candidate < todayOnly) year += 1;

        date = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
      }

      const [y, m, d] = date.split("-");
      const [hh, mm] = time.split(":");

      const startDate = new Date(y, m - 1, d, hh, mm);
      const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);

      try {
        // Vérification disponibilité
        const existing = await calendar.events.list({
          calendarId: "primary",
          timeMin: startDate.toISOString(),
          timeMax: endDate.toISOString(),
          singleEvents: true,
        });

        if (existing.data.items.length > 0) {
          reply = "Ce créneau est déjà réservé.";
        } else {

          // Suppression ancien RDV si modification
          if (lastCreatedEvent[callSid]) {
            try {
              await calendar.events.delete({
                calendarId: "primary",
                eventId: lastCreatedEvent[callSid],
              });
            } catch (e) {}
          }

          const createdEvent = await calendar.events.insert({
            calendarId: "primary",
            resource: {
              summary: "Rendez-vous client",
              start: {
                dateTime: startDate.toISOString(),
                timeZone: "Europe/Paris",
              },
              end: {
                dateTime: endDate.toISOString(),
                timeZone: "Europe/Paris",
              },
            },
          });

          lastCreatedEvent[callSid] = createdEvent.data.id;
          reply = "Votre rendez-vous est confirmé.";
        }
      } catch (err) {
        reply = "Un problème est survenu lors de la réservation.";
      }
    }

    /* ================= DELETE ================= */

    const deleteMatch = reply.match(/\[DELETE date="([^"]+)" time="([^"]+)"\]/);

    if (deleteMatch) {
      const date = deleteMatch[1];
      const time = deleteMatch[2];

      const start = new Date(`${date}T${time}:00`);
      const end = new Date(start.getTime() + 60 * 60 * 1000);

      try {
        const events = await calendar.events.list({
          calendarId: "primary",
          timeMin: start.toISOString(),
          timeMax: end.toISOString(),
        });

        if (events.data.items.length > 0) {
          await calendar.events.delete({
            calendarId: "primary",
            eventId: events.data.items[0].id,
          });
          reply = "Le rendez-vous a été supprimé.";
        } else {
          reply = "Je ne trouve aucun rendez-vous à cette heure.";
        }
      } catch {
        reply = "Impossible de supprimer le rendez-vous.";
      }
    }

    reply = reply.replace(/\[.*?\]/g, "").trim();
    conversations[callSid].push({ role: "assistant", content: reply });

    res.type("text/xml");
    res.send(buildTwiML(reply));

  } catch (error) {
    res.type("text/xml");
    res.send(buildTwiML("Une erreur technique est survenue."));
  }
});

/* ================= SERVER ================= */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Serveur demarre sur le port " + PORT);
});

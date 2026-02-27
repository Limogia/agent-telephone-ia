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
  if (!text || typeof text !== "string") return "Je vous ecoute.";
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
  if (!message || message.length < 2) message = "Tres bien.";

  return `
<Response>
  <Gather input="speech" timeout="5" speechTimeout="auto" language="fr-FR" action="/process-speech" method="POST">
    <Say language="fr-FR">
      ${message}
    </Say>
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

  conversations[callSid] = [
    {
      role: "system",
      content: `
Tu es une assistante telephonique francaise naturelle.
Tu peux discuter librement.
Tu peux creer, supprimer ou verifier un rendez vous.

Quand une action est necessaire, termine par :

[CREATE date="YYYY-MM-DD" time="HH:MM"]
[DELETE date="YYYY-MM-DD" time="HH:MM"]
[CHECK date="YYYY-MM-DD" time="HH:MM"]

Ne lis jamais les balises.
`,
    },
  ];

  res.type("text/xml");
  res.send(buildTwiML("Bonjour, comment puis je vous aider ?"));
});

/* ================= TRAITEMENT ================= */

app.post("/process-speech", async (req, res) => {
  const speech = (req.body.SpeechResult || "").trim();
  const callSid = req.body.CallSid;

  if (!speech) {
    res.type("text/xml");
    return res.send(buildTwiML("Je ne vous ai pas entendu, pouvez vous repeter ?"));
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
      "Je n ai pas compris.";

    /* ================= CREATE ================= */

    const createMatch = reply.match(/\[CREATE date="([^"]+)" time="([^"]+)"\]/);

    if (createMatch) {
      const date = createMatch[1];
      const time = createMatch[2];

      const startDate = new Date(`${date}T${time}:00`);

      if (isNaN(startDate)) {
        reply = "La date semble invalide.";
      } else {
        const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);

        try {
          await calendar.events.insert({
            calendarId: "primary",
            resource: {
              summary: "Rendez vous client",
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

          reply = "Votre rendez vous est confirme.";
        } catch (calendarError) {
          console.error("ERREUR GOOGLE CREATE :", calendarError.response?.data || calendarError.message);
          reply = "Je n arrive pas a creer le rendez vous pour le moment.";
        }
      }
    }

    /* ================= DELETE ================= */

    const deleteMatch = reply.match(/\[DELETE date="([^"]+)" time="([^"]+)"\]/);

    if (deleteMatch) {
      const startDate = new Date(`${deleteMatch[1]}T${deleteMatch[2]}:00`);

      try {
        const events = await calendar.events.list({
          calendarId: "primary",
          timeMin: startDate.toISOString(),
          timeMax: new Date(startDate.getTime() + 60 * 60 * 1000).toISOString(),
        });

        if (events.data.items.length > 0) {
          await calendar.events.delete({
            calendarId: "primary",
            eventId: events.data.items[0].id,
          });
          reply = "Le rendez vous a ete supprime.";
        } else {
          reply = "Je ne trouve aucun rendez vous a cette heure.";
        }
      } catch (calendarError) {
        console.error("ERREUR GOOGLE DELETE :", calendarError.response?.data || calendarError.message);
        reply = "Impossible de supprimer le rendez vous.";
      }
    }

    /* ================= CHECK ================= */

    const checkMatch = reply.match(/\[CHECK date="([^"]+)" time="([^"]+)"\]/);

    if (checkMatch) {
      const startDate = new Date(`${checkMatch[1]}T${checkMatch[2]}:00`);

      try {
        const events = await calendar.events.list({
          calendarId: "primary",
          timeMin: startDate.toISOString(),
          timeMax: new Date(startDate.getTime() + 60 * 60 * 1000).toISOString(),
        });

        reply =
          events.data.items.length > 0
            ? "Ce creneau est deja pris."
            : "Ce creneau est disponible.";
      } catch (calendarError) {
        console.error("ERREUR GOOGLE CHECK :", calendarError.response?.data || calendarError.message);
        reply = "Je n arrive pas a verifier ce creneau.";
      }
    }

    /* ================= NETTOYAGE ================= */

    reply = reply.replace(/\[.*?\]/g, "").trim();

    conversations[callSid].push({ role: "assistant", content: reply });

    res.type("text/xml");
    res.send(buildTwiML(reply));

  } catch (error) {
    console.error("ERREUR OPENAI :", error.message);

    res.type("text/xml");
    res.send(buildTwiML("Une erreur technique est survenue."));
  }
});

/* ================= SERVER ================= */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Serveur demarre sur le port " + PORT);
});

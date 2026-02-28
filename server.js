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
    <Say voice="Polly.Celine" language="fr-FR">
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
  const today = new Date().toISOString().split("T")[0];

  conversations[callSid] = [
    {
      role: "system",
      content: `
Tu es une assistante telephonique francaise naturelle.

La date actuelle est : ${today}

REGLES IMPORTANTES :

- Si l utilisateur ne precise pas l annee, utilise l annee en cours.
- Si la date est deja passee cette annee, utilise l annee suivante.
- Si la date est relative (demain, lundi prochain, dans deux semaines), convertis en date exacte.
- Si on parle du meme rendez vous, ne le recrée jamais.
- Si meme date et meme heure existent deja, confirme simplement.

Quand une action est necessaire, termine STRICTEMENT par :

[CREATE date="YYYY-MM-DD" time="HH:MM"]
[DELETE date="YYYY-MM-DD" time="HH:MM"]
[CHECK date="YYYY-MM-DD" time="HH:MM"]

Ne lis jamais les balises.
Ne mets rien apres les balises.
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

    let reply = completion?.choices?.[0]?.message?.content || "Je n ai pas compris.";

    /* ================= CREATE INTELLIGENT ================= */

    const createMatch = reply.match(/\[CREATE date="([^"]+)" time="([^"]+)"\]/);

    if (createMatch) {
      const date = createMatch[1];
      const time = createMatch[2];

      const startISO = new Date(`${date}T${time}:00`).toISOString();
      const endISO = new Date(new Date(startISO).getTime() + 60 * 60 * 1000).toISOString();

      try {
        const existingEvents = await calendar.events.list({
          calendarId: "primary",
          timeMin: startISO,
          timeMax: endISO,
          singleEvents: true,
        });

        if (existingEvents.data.items.length > 0) {
          const existingEvent = existingEvents.data.items[0];
          const existingStart = new Date(existingEvent.start.dateTime).toISOString();
          const existingEnd = new Date(existingEvent.end.dateTime).toISOString();

          if (existingStart === startISO && existingEnd === endISO) {
            reply = "Ce rendez vous existe deja.";
          } else {
            await calendar.events.update({
              calendarId: "primary",
              eventId: existingEvent.id,
              requestBody: {
                summary: "Rendez vous client",
                start: { dateTime: startISO, timeZone: "Europe/Paris" },
                end: { dateTime: endISO, timeZone: "Europe/Paris" },
              },
            });

            reply = "Votre rendez vous a ete modifie.";
          }
        } else {
          await calendar.events.insert({
            calendarId: "primary",
            requestBody: {
              summary: "Rendez vous client",
              start: { dateTime: startISO, timeZone: "Europe/Paris" },
              end: { dateTime: endISO, timeZone: "Europe/Paris" },
            },
          });

          reply = "Votre rendez vous est confirme.";
        }
      } catch (calendarError) {
        console.error("ERREUR GOOGLE CREATE :", calendarError.response?.data || calendarError.message);
        reply = "Il y a un probleme de reservation.";
      }
    }

    /* ================= DELETE ================= */

    const deleteMatch = reply.match(/\[DELETE date="([^"]+)" time="([^"]+)"\]/);

    if (deleteMatch) {
      const date = deleteMatch[1];
      const time = deleteMatch[2];

      try {
        const startISO = new Date(`${date}T${time}:00`).toISOString();
        const endISO = new Date(new Date(startISO).getTime() + 60 * 60 * 1000).toISOString();

        const events = await calendar.events.list({
          calendarId: "primary",
          timeMin: startISO,
          timeMax: endISO,
          singleEvents: true,
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
      } catch (error) {
        console.error("ERREUR GOOGLE DELETE:", error.response?.data || error.message);
        reply = "Impossible de supprimer le rendez vous.";
      }
    }

    /* ================= CHECK ================= */

    const checkMatch = reply.match(/\[CHECK date="([^"]+)" time="([^"]+)"\]/);

    if (checkMatch) {
      const date = checkMatch[1];
      const time = checkMatch[2];

      try {
        const startISO = new Date(`${date}T${time}:00`).toISOString();
        const endISO = new Date(new Date(startISO).getTime() + 60 * 60 * 1000).toISOString();

        const events = await calendar.events.list({
          calendarId: "primary",
          timeMin: startISO,
          timeMax: endISO,
          singleEvents: true,
        });

        reply =
          events.data.items.length > 0
            ? "Ce creneau est deja pris."
            : "Ce creneau est disponible.";
      } catch (error) {
        console.error("ERREUR GOOGLE CHECK:", error.response?.data || error.message);
        reply = "Je n arrive pas a verifier ce creneau.";
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
  console.log("Serveur demarre sur le port " + PORT);
});

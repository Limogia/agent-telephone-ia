const express = require("express");
const { google } = require("googleapis");
const OpenAI = require("openai");

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

/* ================================
   OPENAI
================================ */
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/* ================================
   GOOGLE AUTH
================================ */
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

/* ================================
   MEMORY
================================ */
const conversations = {};

/* ================================
   SAFE TEXT (évite TwiML errors)
================================ */
function safeText(text) {
  if (!text) return "Je vous écoute.";
  return text
    .replace(/&/g, "et")
    .replace(/</g, "")
    .replace(/>/g, "")
    .replace(/"/g, "")
    .replace(/'/g, "")
    .trim();
}

/* ================================
   ROOT
================================ */
app.get("/", (req, res) => {
  res.send("Serveur actif ✅");
});

/* ================================
   START CALL
================================ */
app.post("/voice", (req, res) => {
  const callSid = req.body.CallSid;

  conversations[callSid] = [
    {
      role: "system",
      content: `
Tu es une assistante téléphonique française professionnelle.
Tu aides à gérer un agenda Google Calendar.

Si une action est nécessaire, termine EXACTEMENT par :

CREATE|YYYY-MM-DD|HH:MM
DELETE|YYYY-MM-DD|HH:MM
UPDATE|OLD_DATE|OLD_TIME|NEW_DATE|NEW_TIME
CHECK|YYYY-MM-DD|HH:MM

Sinon répond normalement.
`,
    },
  ];

  res.type("text/xml");
  res.send(`
<Response>
  <Gather input="speech" language="fr-FR" action="/process-speech" method="POST" speechTimeout="auto">
    <Say voice="Polly.Celine-Neural" language="fr-FR">
      Bonjour, comment puis-je vous aider ?
    </Say>
  </Gather>
</Response>
`);
});

/* ================================
   PROCESS SPEECH
================================ */
app.post("/process-speech", async (req, res) => {
  const speech = req.body.SpeechResult || "";
  const callSid = req.body.CallSid;

  try {
    if (!conversations[callSid]) conversations[callSid] = [];

    conversations[callSid].push({ role: "user", content: speech });

    /* ---- GPT ---- */
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: conversations[callSid],
      temperature: 0.3,
    });

    let reply =
      completion?.choices?.[0]?.message?.content || "Je n'ai pas compris.";

    /* ================= ACTION DETECTION ================= */

    const actionRegex =
      /(CREATE|DELETE|CHECK)\|(\d{4}-\d{2}-\d{2})\|(\d{2}:\d{2})|UPDATE\|(\d{4}-\d{2}-\d{2})\|(\d{2}:\d{2})\|(\d{4}-\d{2}-\d{2})\|(\d{2}:\d{2})/;

    const match = reply.match(actionRegex);

    if (match) {
      const full = match[0];
      const parts = full.split("|");
      const action = parts[0];

      /* ================= CREATE ================= */
      if (action === "CREATE") {
        const start = new Date(`${parts[1]}T${parts[2]}:00`);

        await calendar.events.insert({
          calendarId: "primary",
          resource: {
            summary: "Rendez-vous client",
            start: {
              dateTime: start.toISOString(),
              timeZone: "Europe/Paris",
            },
            end: {
              dateTime: new Date(start.getTime() + 3600000).toISOString(),
              timeZone: "Europe/Paris",
            },
          },
        });

        reply = "Votre rendez-vous est confirmé.";
      }

      /* ================= DELETE ================= */
      if (action === "DELETE") {
        const start = new Date(`${parts[1]}T${parts[2]}:00`);

        const events = await calendar.events.list({
          calendarId: "primary",
          timeMin: start.toISOString(),
          timeMax: new Date(start.getTime() + 3600000).toISOString(),
        });

        if (events.data.items.length > 0) {
          await calendar.events.delete({
            calendarId: "primary",
            eventId: events.data.items[0].id,
          });

          reply = "Le rendez-vous a été supprimé.";
        } else {
          reply = "Je n'ai trouvé aucun rendez-vous à cette heure.";
        }
      }

      /* ================= CHECK ================= */
      if (action === "CHECK") {
        const start = new Date(`${parts[1]}T${parts[2]}:00`);

        const events = await calendar.events.list({
          calendarId: "primary",
          timeMin: start.toISOString(),
          timeMax: new Date(start.getTime() + 3600000).toISOString(),
        });

        reply =
          events.data.items.length > 0
            ? "Ce créneau est déjà pris."
            : "Ce créneau est disponible.";
      }

      /* ================= UPDATE ================= */
      if (action === "UPDATE") {
        const oldStart = new Date(`${parts[1]}T${parts[2]}:00`);
        const newStart = new Date(`${parts[3]}T${parts[4]}:00`);

        const events = await calendar.events.list({
          calendarId: "primary",
          timeMin: oldStart.toISOString(),
          timeMax: new Date(oldStart.getTime() + 3600000).toISOString(),
        });

        if (events.data.items.length > 0) {
          await calendar.events.update({
            calendarId: "primary",
            eventId: events.data.items[0].id,
            resource: {
              summary: "Rendez-vous client modifié",
              start: {
                dateTime: newStart.toISOString(),
                timeZone: "Europe/Paris",
              },
              end: {
                dateTime: new Date(newStart.getTime() + 3600000).toISOString(),
                timeZone: "Europe/Paris",
              },
            },
          });

          reply = "Votre rendez-vous a été modifié.";
        } else {
          reply = "Je n'ai pas trouvé le rendez-vous à modifier.";
        }
      }
    }

    reply = safeText(reply);
    conversations[callSid].push({ role: "assistant", content: reply });

    /* ================= TWIML RESPONSE ================= */
    res.type("text/xml");
    res.send(`
<Response>
  <Gather input="speech" language="fr-FR" action="/process-speech" method="POST" speechTimeout="auto">
    <Say voice="Polly.Celine-Neural" language="fr-FR">
      ${reply}
    </Say>
  </Gather>
</Response>
`);
  } catch (err) {
    console.error("ERREUR :", err);

    res.type("text/xml");
    res.send(`
<Response>
  <Say voice="Polly.Celine-Neural" language="fr-FR">
    Une erreur technique est survenue.
  </Say>
</Response>
`);
  }
});

/* ================================
   SERVER START
================================ */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Serveur démarré sur " + PORT);
});

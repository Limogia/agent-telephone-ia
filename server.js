const express = require("express");
const { google } = require("googleapis");
const OpenAI = require("openai");

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

/* ========= OPENAI ========= */

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/* ========= GOOGLE ========= */

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

/* ========= MEMORY ========= */

const conversations = {};

/* ========= XML SAFE ========= */

function safeText(text) {
  if (!text || typeof text !== "string") {
    return "Je vous écoute.";
  }

  return text
    .replace(/&/g, "et")
    .replace(/</g, "")
    .replace(/>/g, "")
    .replace(/"/g, "")
    .replace(/'/g, "")
    .trim();
}

/* ========= ROOT ========= */

app.get("/", (req, res) => {
  res.send("Serveur actif ✅");
});

/* ========= START CALL ========= */

app.post("/voice", (req, res) => {
  const callSid = req.body.CallSid;

  conversations[callSid] = [
    {
      role: "system",
      content: `
Tu es une assistante téléphonique française naturelle.

Quand il faut agir, termine STRICTEMENT par une seule ligne :

CREATE|YYYY-MM-DD|HH:MM
DELETE|YYYY-MM-DD|HH:MM
UPDATE|OLD_DATE|OLD_TIME|NEW_DATE|NEW_TIME
CHECK|YYYY-MM-DD|HH:MM

Sinon parle normalement.
Ne lis jamais ces commandes à voix haute.
`,
    },
  ];

  res.type("text/xml");
  res.send(`
    <Response>
      <Gather input="speech" language="fr-FR" action="/process-speech" method="POST">
        <Say voice="Polly.Celine-Neural" language="fr-FR">
          Bonjour, comment puis-je vous aider ?
        </Say>
      </Gather>
    </Response>
  `);
});

/* ========= PROCESS ========= */

app.post("/process-speech", async (req, res) => {
  const speech = req.body.SpeechResult || "";
  const callSid = req.body.CallSid;

  try {
    if (!conversations[callSid]) conversations[callSid] = [];

    conversations[callSid].push({ role: "user", content: speech });

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: conversations[callSid],
    });

    let reply =
      completion?.choices?.[0]?.message?.content || "Je n'ai pas compris.";

    /* ===== DETECT ACTION ===== */

    const lines = reply.split("\n");
    const lastLine = lines[lines.length - 1].trim();

    const parts = lastLine.split("|");

    if (parts.length >= 3) {
      const action = parts[0];

      /* ===== CREATE ===== */
      if (action === "CREATE") {
        const date = parts[1];
        const time = parts[2];

        const start = new Date(`${date}T${time}:00`);

        await calendar.events.insert({
          calendarId: "primary",
          resource: {
            summary: "Rendez-vous client",
            start: { dateTime: start.toISOString(), timeZone: "Europe/Paris" },
            end: {
              dateTime: new Date(start.getTime() + 3600000).toISOString(),
              timeZone: "Europe/Paris",
            },
          },
        });

        reply = lines.slice(0, -1).join(" ") +
          " Votre rendez-vous est confirmé.";
      }

      /* ===== DELETE ===== */
      if (action === "DELETE") {
        const date = parts[1];
        const time = parts[2];

        const start = new Date(`${date}T${time}:00`);

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

          reply = lines.slice(0, -1).join(" ") +
            " Le rendez-vous a été supprimé.";
        } else {
          reply = "Je n'ai trouvé aucun rendez-vous à cette heure.";
        }
      }

      /* ===== UPDATE ===== */
      if (action === "UPDATE" && parts.length === 5) {
        const oldDate = parts[1];
        const oldTime = parts[2];
        const newDate = parts[3];
        const newTime = parts[4];

        const oldStart = new Date(`${oldDate}T${oldTime}:00`);

        const events = await calendar.events.list({
          calendarId: "primary",
          timeMin: oldStart.toISOString(),
          timeMax: new Date(oldStart.getTime() + 3600000).toISOString(),
        });

        if (events.data.items.length > 0) {
          const event = events.data.items[0];
          const newStart = new Date(`${newDate}T${newTime}:00`);

          await calendar.events.update({
            calendarId: "primary",
            eventId: event.id,
            resource: {
              summary: event.summary,
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

          reply = lines.slice(0, -1).join(" ") +
            " Le rendez-vous a été modifié.";
        } else {
          reply = "Je n'ai trouvé aucun rendez-vous correspondant.";
        }
      }

      /* ===== CHECK ===== */
      if (action === "CHECK") {
        const date = parts[1];
        const time = parts[2];

        const start = new Date(`${date}T${time}:00`);

        const events = await calendar.events.list({
          calendarId: "primary",
          timeMin: start.toISOString(),
          timeMax: new Date(start.getTime() + 3600000).toISOString(),
        });

        if (events.data.items.length > 0) {
          reply = "Ce créneau est déjà pris.";
        } else {
          reply = "Ce créneau est disponible.";
        }
      }
    }

    reply = safeText(reply);

    conversations[callSid].push({ role: "assistant", content: reply });

    res.type("text/xml");
    res.send(`
      <Response>
        <Gather input="speech" language="fr-FR" action="/process-speech" method="POST">
          <Say voice="Polly.Celine-Neural" language="fr-FR">
            ${reply}
          </Say>
        </Gather>
      </Response>
    `);

  } catch (err) {
    console.error("Erreur:", err);

    res.type("text/xml");
    res.send(`
      <Response>
        <Say voice="Polly.Celine-Neural" language="fr-FR">
          Désolé, une erreur technique est survenue.
        </Say>
      </Response>
    `);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Serveur démarré sur " + PORT);
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Serveur démarré sur le port " + PORT);
});

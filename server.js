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

/* ================= SECURITE XML ================= */

function escapeXml(text) {
  if (!text || typeof text !== "string") {
    return "Je vous ecoute.";
  }

  return text
    .replace(/&/g, "et")
    .replace(/</g, "")
    .replace(/>/g, "")
    .replace(/"/g, "")
    .replace(/'/g, "")
    .trim();
}

/* ================= ROUTE TEST ================= */

app.get("/", (req, res) => {
  res.send("Serveur actif");
});

/* ================= DEMARRAGE APPEL ================= */

app.post("/voice", (req, res) => {
  const callSid = req.body.CallSid;

  conversations[callSid] = [
    {
      role: "system",
      content: `
Tu es une assistante telephonique francaise naturelle.
Tu peux discuter librement.
Tu peux creer, supprimer ou verifier un rendez vous.

Quand une action est necessaire, termine ta phrase par :

[CREATE date="YYYY-MM-DD" time="HH:MM"]
[DELETE date="YYYY-MM-DD" time="HH:MM"]
[CHECK date="YYYY-MM-DD" time="HH:MM"]

Ne lis jamais ces balises a voix haute.
`,
    },
  ];

  res.type("text/xml");
  res.send(`
<Response>
  <Gather input="speech" timeout="5" speechTimeout="auto" language="fr-FR" action="/process-speech" method="POST">
    <Say voice="Polly.Celine-Neural" language="fr-FR">
      Bonjour, comment puis je vous aider ?
    </Say>
  </Gather>
</Response>
`);
});

/* ================= TRAITEMENT ================= */

app.post("/process-speech", async (req, res) => {
  const speech = (req.body.SpeechResult || "").trim();
  const callSid = req.body.CallSid;

  if (!speech) {
    res.type("text/xml");
    return res.send(`
<Response>
  <Gather input="speech" timeout="5" speechTimeout="auto" language="fr-FR" action="/process-speech" method="POST">
    <Say voice="Polly.Celine-Neural" language="fr-FR">
      Je ne vous ai pas entendu, pouvez vous repeter ?
    </Say>
  </Gather>
</Response>
`);
  }

  if (!conversations[callSid]) {
    conversations[callSid] = [];
  }

  conversations[callSid].push({ role: "user", content: speech });

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: conversations[callSid],
    });

    let reply =
      completion?.choices?.[0]?.message?.content || "Je n ai pas compris.";

    /* ===== CREATE ===== */

    const createMatch = reply.match(/\[CREATE date="([^"]+)" time="([^"]+)"\]/);
    if (createMatch) {
      const date = createMatch[1];
      const time = createMatch[2];

      const start = new Date(`${date}T${time}:00+01:00`);

      if (!isNaN(start)) {
        await calendar.events.insert({
          calendarId: "primary",
          resource: {
            summary: "Rendez vous client",
            start: { dateTime: start.toISOString(), timeZone: "Europe/Paris" },
            end: {
              dateTime: new Date(start.getTime() + 3600000).toISOString(),
              timeZone: "Europe/Paris",
            },
          },
        });

        reply = "Votre rendez vous est confirme.";
      } else {
        reply = "La date ou l heure est invalide.";
      }
    }

    /* ===== DELETE ===== */

    const deleteMatch = reply.match(/\[DELETE date="([^"]+)" time="([^"]+)"\]/);
    if (deleteMatch) {
      const date = deleteMatch[1];
      const time = deleteMatch[2];

      const start = new Date(`${date}T${time}:00+01:00`);

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
        reply = "Le rendez vous a ete supprime.";
      } else {
        reply = "Je ne trouve aucun rendez vous a cette heure.";
      }
    }

    /* ===== CHECK ===== */

    const checkMatch = reply.match(/\[CHECK date="([^"]+)" time="([^"]+)"\]/);
    if (checkMatch) {
      const date = checkMatch[1];
      const time = checkMatch[2];

      const start = new Date(`${date}T${time}:00+01:00`);

      const events = await calendar.events.list({
        calendarId: "primary",
        timeMin: start.toISOString(),
        timeMax: new Date(start.getTime() + 3600000).toISOString(),
      });

      if (events.data.items.length > 0) {
        reply = "Ce creneau est deja pris.";
      } else {
        reply = "Ce creneau est disponible.";
      }
    }

    /* ===== NETTOYAGE FINAL ANTI BUG TWILIO ===== */

    reply = reply.replace(/\[.*?\]/g, "").trim();
    reply = escapeXml(reply);

    if (!reply || reply.length < 2) {
      reply = "Tres bien.";
    }

    if (typeof reply !== "string") {
      reply = "Je vous ecoute.";
    }

    conversations[callSid].push({ role: "assistant", content: reply });

    res.type("text/xml");
    res.send(`
<Response>
  <Gather input="speech" timeout="5" speechTimeout="auto" language="fr-FR" action="/process-speech" method="POST">
    <Say voice="Polly.Celine-Neural" language="fr-FR">
      ${reply}
    </Say>
  </Gather>
</Response>
`);

  } catch (error) {
    console.error("ERREUR DETAILLEE :", error.response?.data || error.message);

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

/* ================= SERVER ================= */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Serveur demarre sur le port " + PORT);
});

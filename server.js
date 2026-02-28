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
const lastEventByCall = {};

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

function cleanFrench(text) {
  if (!text) return text;
  return text
    .replace(/\bconfirme\b/gi, "confirmé")
    .replace(/\bsupprime\b/gi, "supprimé")
    .replace(/\bmodifie\b/gi, "modifié")
    .replace(/\bcree\b/gi, "créé")
    .replace(/\bete\b/gi, "été")
    .replace(/\ba ete\b/gi, "a été");
}

function buildTwiML(message) {
  message = escapeXml(message);
  if (!message || message.length < 2) message = "Très bien.";

  return `
<Response>
  <Gather 
      input="speech"
      timeout="12"
      speechTimeout="6"
      language="fr-FR"
      action="/process-speech"
      method="POST">
    <Say language="fr-FR">
      ${message}
    </Say>
  </Gather>

  <Say language="fr-FR">
    Je suis toujours à votre écoute.
  </Say>
  <Redirect method="POST">/voice</Redirect>
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
Tu es une assistante téléphonique française naturelle.
Quand une action est nécessaire, termine par :

[CREATE date="YYYY-MM-DD" time="HH:MM"]
[DELETE date="YYYY-MM-DD" time="HH:MM"]
[CHECK date="YYYY-MM-DD" time="HH:MM"]

Ne lis jamais les balises.
Si on modifie un rendez-vous, il faut déplacer l'existant et ne jamais en recréer un.
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
      "Je n'ai pas compris.";

    /* ================= CREATE / MOVE ================= */

    const createMatch = reply.match(/\[CREATE date="([^"]+)" time="([^"]+)"\]/);

    if (createMatch) {
      const date = createMatch[1];
      const time = createMatch[2];

      const startLocal = `${date}T${time}:00`;
      const endDate = new Date(startLocal);
      endDate.setHours(endDate.getHours() + 1);

      const endLocal =
        `${date}T${String(endDate.getHours()).padStart(2,"0")}:${String(endDate.getMinutes()).padStart(2,"0")}:00`;

      try {
        if (lastEventByCall[callSid]) {
          await calendar.events.update({
            calendarId: "primary",
            eventId: lastEventByCall[callSid],
            resource: {
              summary: "Rendez-vous client",
              start: { dateTime: startLocal, timeZone: "Europe/Paris" },
              end: { dateTime: endLocal, timeZone: "Europe/Paris" },
            },
          });

          reply = "Votre rendez-vous a été déplacé.";
        } else {
          const event = await calendar.events.insert({
            calendarId: "primary",
            resource: {
              summary: "Rendez-vous client",
              start: { dateTime: startLocal, timeZone: "Europe/Paris" },
              end: { dateTime: endLocal, timeZone: "Europe/Paris" },
            },
          });

          lastEventByCall[callSid] = event.data.id;
          reply = "Votre rendez-vous est confirmé.";
        }

      } catch (calendarError) {
        console.error("ERREUR GOOGLE CREATE :", calendarError.response?.data || calendarError.message);
        reply = "Il y a un problème de réservation.";
      }
    }

    /* ================= DELETE ================= */

    const deleteMatch = reply.match(/\[DELETE date="([^"]+)" time="([^"]+)"\]/);

    if (deleteMatch && lastEventByCall[callSid]) {
      try {
        await calendar.events.delete({
          calendarId: "primary",
          eventId: lastEventByCall[callSid],
        });

        delete lastEventByCall[callSid];
        reply = "Le rendez-vous a été supprimé.";
      } catch (error) {
        reply = "Impossible de supprimer le rendez-vous.";
      }
    }

    /* ================= CHECK ================= */

    const checkMatch = reply.match(/\[CHECK date="([^"]+)" time="([^"]+)"\]/);

    if (checkMatch) {
      const date = checkMatch[1];
      const time = checkMatch[2];

      const startLocal = `${date}T${time}:00`;
      const endDate = new Date(startLocal);
      endDate.setHours(endDate.getHours() + 1);

      const events = await calendar.events.list({
        calendarId: "primary",
        timeMin: startLocal,
        timeMax: endDate.toISOString(),
        singleEvents: true,
      });

      reply =
        events.data.items.length > 0
          ? "Ce créneau est déjà pris."
          : "Ce créneau est disponible.";
    }

    reply = reply.replace(/\[.*?\]/g, "").trim();
    reply = cleanFrench(reply);

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

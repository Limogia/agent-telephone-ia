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
    <Say language="fr-FR">${message}</Say>
     <Gather input="speech"
        timeout="8"
        speechTimeout="3"
        language="fr-FR"
        action="/process-speech"
        method="POST">
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
Cette date est la référence absolue pour déterminer l'année en cours.

Règles obligatoires :
- Tu dois toujours écrire les dates au format EXACT : YYYY-MM-DD.
- Si le client ne précise pas l’année, utilise l’année en cours basée sur la date actuelle ci-dessus.
- Si la date est déjà passée cette année, utilise l’année suivante.
- Toujours : année-mois-jour.
- En cas de doute sur la date, demande une précision.

Règles supplémentaires obligatoires :
- Corrige automatiquement toutes les fautes d’orthographe.
- Utilise toujours les accents correctement.
- N’écris jamais "confirme" mais "confirmé".
- N’écris jamais "supprime" mais "supprimé".
- N’écris jamais "cree" mais "créé".
- Tes réponses doivent être grammaticalement parfaites.

Actions possibles :

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
      let date = createMatch[1];
      const time = createMatch[2];

      const today = new Date();

      if (date.split("-").length === 2) {
        const parts = date.split("-");
        let month, day;

        if (parseInt(parts[0]) > 12) {
          day = parts[0];
          month = parts[1];
        } else {
          month = parts[0];
          day = parts[1];
        }

        let year = today.getFullYear();
        let testDate = new Date(`${year}-${month}-${day}T${time}:00`);

        if (testDate < today) {
          year += 1;
        }

        date = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
      }

      const startDateTime = `${date}T${time}:00`;
      const endDate = new Date(startDateTime);
      const endDateTime = new Date(endDate.getTime() + 60 * 60 * 1000);

      try {

  // Supprime l'ancien rendez-vous créé pendant cet appel (si existant)
  if (lastCreatedEvent[callSid]) {
    try {
      await calendar.events.delete({
        calendarId: "primary",
        eventId: lastCreatedEvent[callSid],
      });
    } catch (e) {}
  }

        // Vérification disponibilité
const existing = await calendar.events.list({
  calendarId: "primary",
  timeMin: startDateTime,
  timeMax: endDateTime.toISOString(),
  singleEvents: true,
});

if (existing.data.items.length > 0) {
  reply = "Ce créneau est déjà réservé.";
} else {...}
        
  const createdEvent = await calendar.events.insert({
    calendarId: "primary",
    resource: {
      summary: "Rendez vous client",
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

  // On stocke l'id pour pouvoir le supprimer si modification
  lastCreatedEvent[callSid] = createdEvent.data.id;

  reply = "Votre rendez-vous est confirmé.";

} catch (calendarError) {
  console.error("ERREUR GOOGLE CREATE :", calendarError.response?.data || calendarError.message);
  reply = "Un problème est survenu lors de la réservation.";
}

    /* ================= DELETE ================= */
    const deleteMatch = reply.match(/\[DELETE date="([^"]+)" time="([^"]+)"\]/);

    if (deleteMatch) {
      const date = deleteMatch[1];
      const time = deleteMatch[2];

      try {
        const events = await calendar.events.list({
          calendarId: "primary",
          timeMin: `${date}T${time}:00+01:00`,
          timeMax: `${date}T${time}:59+01:00`,
        });

        if (events.data.items.length > 0) {
          await calendar.events.delete({
            calendarId: "primary",
            eventId: events.data.items[0].id,
          });
          reply = "Le rendez vous a été supprimé.";
        } else {
          reply = "Je ne trouve aucun rendez vous à cette heure.";
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
        const events = await calendar.events.list({
          calendarId: "primary",
          timeMin: `${date}T${time}:00+01:00`,
          timeMax: `${date}T${time}:59+01:00`,
        });

        reply =
          events.data.items.length > 0
            ? "Ce créneau est déjà pris."
            : "Ce créneau est disponible.";
      } catch (error) {
        console.error("ERREUR GOOGLE CHECK:", error.response?.data || error.message);
        reply = "Je n arrive pas à vérifier ce créneau.";
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

const express = require("express");
const { google } = require("googleapis");
const OpenAI = require("openai");
const axios = require("axios");

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

/* ================= ELEVENLABS ================= */

const fs = require("fs");
const path = require("path");

const audioDir = path.join(__dirname, "audio");

if (!fs.existsSync(audioDir)) {
  fs.mkdirSync(audioDir);
}

app.use("/audio", express.static(audioDir));

async function generateSpeech(text) {
  const fileName = `speech_${Date.now()}.mp3`;
  const filePath = path.join(audioDir, fileName);

  const response = await axios({
    method: "POST",
    url: `https://api.elevenlabs.io/v1/text-to-speech/${process.env.EMILIEVOICE_ID}`,
    headers: {
      "xi-api-key": process.env.ELEVENLABS_API_KEY,
      "Content-Type": "application/json"
    },
    data: {
      text: text,
      model_id: "eleven_multilingual_v2",
      voice_settings: {
        stability: 0.7,
        similarity_boost: 0.85
      }
    },
    responseType: "arraybuffer"
  });

  fs.writeFileSync(filePath, response.data);

  // nettoyage automatique après 60 secondes
  setTimeout(() => {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }, 60000);

  return fileName;
}

async function buildTwiML(message) {
  message = escapeXml(message);
  if (!message || message.length < 2) message = "Tres bien.";

  const fileName = await generateSpeech(message);

  return `
<Response>
  <Play>${process.env.BASE_URL}/audio/${fileName}</Play>
  <Gather input="speech" timeout="5" speechTimeout="auto" language="fr-FR" action="/process-speech" method="POST" />
</Response>
`;
}

/* ================= ROUTE TEST ================= */

app.get("/", (req, res) => {
  res.send("Serveur actif");
});

app.get("/test-voice", async (req, res) => {
  try {
    const audioBase64 = await generateSpeech("Bonjour, ceci est un test de la voix Emilie depuis Railway.");
    const buffer = Buffer.from(audioBase64, "base64");
    res.setHeader("Content-Type", "audio/mpeg");
    res.send(buffer);
  } catch (error) {
    console.error("ERREUR ELEVENLABS:", error.response?.data || error.message);
    res.status(500).send("Erreur ElevenLabs");
  }
});

/* ================= APPEL INITIAL ================= */

app.post("/voice", async (req, res) => {
  const callSid = req.body.CallSid;

  conversations[callSid] = [
    {
      role: "system",
      content: `
Tu es une assistante téléphonique française naturelle et professionnelle.

Règles obligatoires :
- Tu dois toujours écrire les dates au format EXACT : YYYY-MM-DD.
- Si le client ne précise pas l’année, utilise l’année en cours.
- Si la date est déjà passée cette année, utilise l’année suivante.
- Toujours : année-mois-jour.
- En cas de doute sur la date, demande une précision.

Actions possibles :

[CREATE date="YYYY-MM-DD" time="HH:MM"]
[DELETE date="YYYY-MM-DD" time="HH:MM"]
[CHECK date="YYYY-MM-DD" time="HH:MM"]

Ne lis jamais les balises.
`,
    },
  ];

  res.type("text/xml");
  res.send(await buildTwiML("Bonjour, comment puis je vous aider ?"));
});

/* ================= TRAITEMENT ================= */

app.post("/process-speech", async (req, res) => {
  const speech = (req.body.SpeechResult || "").trim();
  const callSid = req.body.CallSid;

  if (!speech) {
    res.type("text/xml");
    return res.send(await buildTwiML("Je ne vous ai pas entendu, pouvez vous repeter ?"));
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

    /* === TOUTE TA LOGIQUE CREATE / DELETE / CHECK EST STRICTEMENT IDENTIQUE === */

    const createMatch = reply.match(/\[CREATE date="([^"]+)" time="([^"]+)"\]/);

    if (createMatch) {
      const date = createMatch[1];
      const time = createMatch[2];

      const startDateTime = `${date}T${time}:00`;
      const endDate = new Date(`${date}T${time}:00`);
      const endDateTime = new Date(endDate.getTime() + 60 * 60 * 1000);

      try {
        await calendar.events.insert({
          calendarId: "primary",
          resource: {
            summary: "Rendez vous client",
            start: {
              dateTime: startDateTime,
              timeZone: "Europe/Paris",
            },
            end: {
              dateTime: `${date}T${String(endDateTime.getHours()).padStart(2,"0")}:${String(endDateTime.getMinutes()).padStart(2,"0")}:00`,
              timeZone: "Europe/Paris",
            },
          },
        });

        reply = "Votre rendez vous est confirme.";
      } catch (calendarError) {
        reply = "Il y a un probleme de reservation.";
      }
    }

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
          reply = "Le rendez vous a ete supprime.";
        } else {
          reply = "Je ne trouve aucun rendez vous a cette heure.";
        }
      } catch (error) {
        reply = "Impossible de supprimer le rendez vous.";
      }
    }

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
            ? "Ce creneau est deja pris."
            : "Ce creneau est disponible.";
      } catch (error) {
        reply = "Je n arrive pas a verifier ce creneau.";
      }
    }

    reply = reply.replace(/\[.*?\]/g, "").trim();

    conversations[callSid].push({ role: "assistant", content: reply });

    res.type("text/xml");
    res.send(await buildTwiML(reply));

  } catch (error) {
    res.type("text/xml");
    res.send(await buildTwiML("Une erreur technique est survenue."));
  }
});

/* ================= SERVER ================= */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Serveur demarre sur le port " + PORT);
});

const express = require("express");
const { google } = require("googleapis");
const OpenAI = require("openai");

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

/* ================= CONFIG ================= */

const CONSULTATION_DURATION = 30; // minutes
const TIMEZONE = "Europe/Paris";

/* ================= DATE FRANÇAISE TEMPS RÉEL ================= */

function getFrenchNow() {
  return new Date(
    new Date().toLocaleString("en-US", { timeZone: TIMEZONE })
  );
}

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
const sessions = {};

/* ================= TWIML ================= */

function buildTwiML(message) {
  return `
<Response>
  <Gather input="speech"
          timeout="10"
          speechTimeout="auto"
          language="fr-FR"
          action="/process-speech"
          method="POST">
    <Say language="fr-FR">${message}</Say>
  </Gather>
  <Hangup/>
</Response>
`;
}

/* ================= ROUTE TEST ================= */

app.get("/", (req, res) => {
  res.send("Cabinet médical Dr Boutaam actif");
});

/* ================= APPEL INITIAL ================= */

app.post("/voice", (req, res) => {
  const callSid = req.body.CallSid;
  const now = getFrenchNow();

  sessions[callSid] = {
    name: null,
    reason: null,
  };

  conversations[callSid] = [
    {
      role: "system",
      content: `
Nous sommes le ${now.toLocaleDateString("fr-FR")} et il est ${now.toLocaleTimeString("fr-FR")}.
Fuseau horaire obligatoire : Europe/Paris.

Tu es la secrétaire médicale humaine du Docteur Boutaam.

Tu dois :
- Prendre un rendez-vous.
- Demander le nom du patient.
- Demander le motif de consultation.
- Déduire la date si elle n'est pas précisée.
- Si doute, poser la question.
- Une consultation dure 30 minutes.
- Proposer un créneau si celui demandé n'est pas disponible.
- Toujours écrire les dates au format YYYY-MM-DD.
- Si année absente, utiliser 2026.
- Si date passée en 2026, proposer 2027.

Quand toutes les informations sont réunies, terminer par :

[CREATE date="YYYY-MM-DD" time="HH:MM"]

Tu es naturelle, intelligente, avec de la répartie.
Tu peux répondre à toute question même hors rendez-vous.
Ne lis jamais les balises.
`,
    },
  ];

  res.type("text/xml");
  res.send(buildTwiML("Cabinet médical du Docteur Boutaam, bonjour. Comment puis-je vous aider ?"));
});

/* ================= TRAITEMENT ================= */

app.post("/process-speech", async (req, res) => {
  const speech = (req.body.SpeechResult || "").trim();
  const callSid = req.body.CallSid;

  if (!speech) {
    res.type("text/xml");
    return res.send(buildTwiML("Je ne vous entends plus. Je vais raccrocher. Bonne journée."));
  }

  conversations[callSid].push({ role: "user", content: speech });

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: conversations[callSid],
    });

    let reply = completion.choices[0].message.content;

    const createMatch = reply.match(/\[CREATE date="([^"]+)" time="([^"]+)"\]/);

    if (createMatch) {
      const date = createMatch[1];
      const time = createMatch[2];

      const [y, m, d] = date.split("-");
      const [hh, mm] = time.split(":");

      const start = new Date(
        new Date(y, m - 1, d, hh, mm).toLocaleString("en-US", {
          timeZone: TIMEZONE,
        })
      );

      const end = new Date(start.getTime() + CONSULTATION_DURATION * 60000);

      const existing = await calendar.events.list({
        calendarId: "primary",
        timeMin: start.toISOString(),
        timeMax: end.toISOString(),
        singleEvents: true,
      });

      if (existing.data.items.length > 0) {
        reply = "Ce créneau n'est pas disponible. Souhaitez-vous un autre horaire ?";
      } else {
        await calendar.events.insert({
          calendarId: "primary",
          resource: {
            summary: `Consultation - ${sessions[callSid]?.name || "Patient"}`,
            description: `Motif : ${sessions[callSid]?.reason || "Non précisé"}`,
            start: {
              dateTime: start.toISOString(),
              timeZone: TIMEZONE,
            },
            end: {
              dateTime: end.toISOString(),
              timeZone: TIMEZONE,
            },
          },
        });

        reply = "Votre rendez-vous est confirmé. Le Docteur Boutaam vous recevra au cabinet.";
      }
    }

    reply = reply.replace(/\[.*?\]/g, "").trim();
    conversations[callSid].push({ role: "assistant", content: reply });

    res.type("text/xml");
    res.send(buildTwiML(reply));

  } catch (error) {
    res.type("text/xml");
    res.send(buildTwiML("Une erreur technique est survenue. Veuillez rappeler ultérieurement."));
  }
});

/* ================= SERVER ================= */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Secrétariat Dr Boutaam démarré sur port " + PORT);
});

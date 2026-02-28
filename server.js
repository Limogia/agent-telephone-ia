const express = require("express");
const { google } = require("googleapis");
const OpenAI = require("openai");

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

/* ================= CONFIG ================= */

const CONSULTATION_DURATION_MIN = 30;
const CURRENT_YEAR = 2026;

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
const sessionData = {}; // stocke nom + motif + date pendant appel

/* ================= UTIL ================= */

function escapeXml(text) {
  if (!text) return "Très bien.";
  return text
    .replace(/&/g, "et")
    .replace(/</g, "")
    .replace(/>/g, "")
    .replace(/"/g, "")
    .replace(/'/g, "")
    .trim();
}

function buildTwiML(message) {
  return `
<Response>
  <Gather input="speech"
          timeout="10"
          speechTimeout="auto"
          language="fr-FR"
          action="/process-speech"
          method="POST">
    <Say language="fr-FR">${escapeXml(message)}</Say>
  </Gather>
  <Hangup/>
</Response>
`;
}

/* ================= ROUTE TEST ================= */

app.get("/", (req, res) => {
  res.send("Secrétariat médical Dr Boutaam actif");
});

/* ================= APPEL INITIAL ================= */

app.post("/voice", (req, res) => {
  const callSid = req.body.CallSid;

  sessionData[callSid] = {
    name: null,
    reason: null,
    date: null,
    time: null,
  };

  conversations[callSid] = [
    {
      role: "system",
      content: `
Nous sommes en ${CURRENT_YEAR}.

Tu es la secrétaire médicale du Docteur Boutaam.
Tu es naturelle, professionnelle et chaleureuse.

Tu dois :
- Prendre un rendez-vous.
- Demander le nom du patient.
- Demander le motif de consultation.
- Déduire la date si possible.
- Demander clarification si doute.
- Proposer un autre créneau si indisponible.
- Une consultation dure ${CONSULTATION_DURATION_MIN} minutes.
- Toujours écrire les dates au format YYYY-MM-DD.
- Si le patient ne donne pas d'année, utilise ${CURRENT_YEAR}.
- Si la date est passée en ${CURRENT_YEAR}, propose l'année suivante.

Quand toutes les informations sont réunies, termine par :

[CREATE date="YYYY-MM-DD" time="HH:MM"]

Ne lis jamais les balises.
`,
    },
  ];

  res.type("text/xml");
  res.send(buildTwiML("Cabinet médical du Docteur Boutaam, bonjour. Que puis-je faire pour vous ?"));
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

      const startDate = new Date(y, m - 1, d, hh, mm);
      const endDate = new Date(startDate.getTime() + CONSULTATION_DURATION_MIN * 60000);

      // Vérifie disponibilité
      const existing = await calendar.events.list({
        calendarId: "primary",
        timeMin: startDate.toISOString(),
        timeMax: endDate.toISOString(),
        singleEvents: true,
      });

      if (existing.data.items.length > 0) {
        reply = "Ce créneau n'est malheureusement pas disponible. Souhaitez-vous un autre horaire ?";
      } else {
        await calendar.events.insert({
          calendarId: "primary",
          resource: {
            summary: `Consultation - ${sessionData[callSid]?.name || "Patient"}`,
            description: `Motif : ${sessionData[callSid]?.reason || "Non précisé"}`,
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

        reply = "Votre rendez-vous est confirmé. Nous vous attendrons au cabinet du Docteur Boutaam.";
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
  console.log("Serveur Dr Boutaam démarré sur port " + PORT);
});

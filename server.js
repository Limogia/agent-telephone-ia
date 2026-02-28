const express = require("express");
const { google } = require("googleapis");
const OpenAI = require("openai");

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

/* ================= CONFIG ================= */

const TIMEZONE = "Europe/Paris";
const CONSULT_DURATION = 30; // minutes
const CURRENT_DATE = "2026-02-28";

/* ================= DATE FRANCE ================= */

function nowParis() {
  return new Date(
    new Date().toLocaleString("en-US", { timeZone: TIMEZONE })
  );
}

function toISO(date) {
  return new Date(date).toISOString();
}

function formatFR(date) {
  return date.toLocaleString("fr-FR", {
    timeZone: TIMEZONE,
    dateStyle: "full",
    timeStyle: "short",
  });
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
const sessionData = {};

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

/* ================= ROUTE ================= */

app.get("/", (req, res) => {
  res.send("Cabinet médical Dr Boutaam actif");
});

/* ================= APPEL ================= */

app.post("/voice", (req, res) => {

  const callSid = req.body.CallSid;

  sessionData[callSid] = {
    name: null,
    reason: null,
  };

  conversations[callSid] = [
    {
      role: "system",
      content: `
Nous sommes le ${CURRENT_DATE}.
Fuseau horaire obligatoire : Europe/Paris.

Tu es la secrétaire médicale humaine du Docteur Boutaam.

Règles strictes :
- Consultation = 30 minutes.
- Toujours format 24h.
- Si le patient dit 9h → c’est 09:00.
- Si année absente → 2026.
- Si date déjà passée en 2026 → proposer 2027.
- Toujours vérifier EXACTEMENT le créneau demandé.
- Ne jamais inventer une disponibilité.
- Toujours consulter le calendrier réel.
- Si modification → supprimer ancien RDV puis recréer.
- Un patient ne peut supprimer que son propre RDV.
- Toujours demander nom + motif si manquant.
- Être naturelle, fluide, intelligente.

Balises :

[CREATE name="NOM" reason="MOTIF" date="YYYY-MM-DD" time="HH:MM"]
[DELETE name="NOM"]
[MODIFY name="NOM" date="YYYY-MM-DD" time="HH:MM"]

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
    return res.type("text/xml").send(buildTwiML("Je ne vous entends plus. Je vous souhaite une excellente journée."));
  }

  conversations[callSid].push({ role: "user", content: speech });

  try {

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: conversations[callSid],
    });

    let reply = completion.choices[0].message.content;

    /* ================= CREATE ================= */

    const createMatch = reply.match(/\[CREATE name="([^"]+)" reason="([^"]+)" date="([^"]+)" time="([^"]+)"\]/);

    if (createMatch) {

      const name = createMatch[1];
      const reason = createMatch[2];
      const date = createMatch[3];
      const time = createMatch[4];

      const [year, month, day] = date.split("-");
      const [hour, minute] = time.split(":");

      const start = new Date(year, month - 1, day, hour, minute);
      const end = new Date(start.getTime() + CONSULT_DURATION * 60000);

      // Vérification exacte du créneau demandé
      const existing = await calendar.events.list({
        calendarId: "primary",
        timeMin: toISO(start),
        timeMax: toISO(end),
        singleEvents: true,
      });

      if (existing.data.items.length > 0) {

        // Recherche prochain créneau libre
        let candidate = new Date(start);
        let found = false;

        for (let i = 1; i <= 16; i++) {
          candidate = new Date(start.getTime() + i * CONSULT_DURATION * 60000);
          const candidateEnd = new Date(candidate.getTime() + CONSULT_DURATION * 60000);

          const check = await calendar.events.list({
            calendarId: "primary",
            timeMin: toISO(candidate),
            timeMax: toISO(candidateEnd),
            singleEvents: true,
          });

          if (check.data.items.length === 0) {
            reply = `Le créneau demandé n'est pas disponible. Je peux vous proposer le ${formatFR(candidate)}. Cela vous convient-il ?`;
            found = true;
            break;
          }
        }

        if (!found) {
          reply = "Je n'ai pas de disponibilité proche. Souhaitez-vous un autre jour ?";
        }

      } else {

        await calendar.events.insert({
          calendarId: "primary",
          resource: {
            summary: `Consultation - ${name}`,
            description: `Patient : ${name}\nMotif : ${reason}`,
            start: { dateTime: toISO(start), timeZone: TIMEZONE },
            end: { dateTime: toISO(end), timeZone: TIMEZONE },
          },
        });

        reply = `Votre rendez-vous est confirmé le ${formatFR(start)}.`;
      }
    }

    /* ================= DELETE ================= */

    const deleteMatch = reply.match(/\[DELETE name="([^"]+)"\]/);

    if (deleteMatch) {

      const name = deleteMatch[1];

      const events = await calendar.events.list({
        calendarId: "primary",
        q: name,
        singleEvents: true,
      });

      if (events.data.items.length === 0) {
        reply = "Je ne trouve aucun rendez-vous à votre nom.";
      } else {
        await calendar.events.delete({
          calendarId: "primary",
          eventId: events.data.items[0].id,
        });

        reply = "Votre rendez-vous a été supprimé.";
      }
    }

    /* ================= MODIFY ================= */

    const modifyMatch = reply.match(/\[MODIFY name="([^"]+)" date="([^"]+)" time="([^"]+)"\]/);

    if (modifyMatch) {

      const name = modifyMatch[1];
      const date = modifyMatch[2];
      const time = modifyMatch[3];

      const events = await calendar.events.list({
        calendarId: "primary",
        q: name,
        singleEvents: true,
      });

      if (events.data.items.length === 0) {
        reply = "Je ne trouve aucun rendez-vous à modifier.";
      } else {

        await calendar.events.delete({
          calendarId: "primary",
          eventId: events.data.items[0].id,
        });

        const [y, m, d] = date.split("-");
        const [hh, mm] = time.split(":");

        const start = new Date(y, m - 1, d, hh, mm);
        const end = new Date(start.getTime() + CONSULT_DURATION * 60000);

        await calendar.events.insert({
          calendarId: "primary",
          resource: {
            summary: `Consultation - ${name}`,
            start: { dateTime: toISO(start), timeZone: TIMEZONE },
            end: { dateTime: toISO(end), timeZone: TIMEZONE },
          },
        });

        reply = `Votre rendez-vous a été déplacé au ${formatFR(start)}.`;
      }
    }

    reply = reply.replace(/\[.*?\]/g, "").trim();
    conversations[callSid].push({ role: "assistant", content: reply });

    res.type("text/xml");
    res.send(buildTwiML(reply));

  } catch (error) {
    res.type("text/xml");
    res.send(buildTwiML("Une erreur technique est survenue. Merci de rappeler."));
  }
});

/* ================= SERVER ================= */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Secrétariat Dr Boutaam actif sur port " + PORT);
});

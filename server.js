const express = require("express");
const { google } = require("googleapis");
const OpenAI = require("openai");

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

/* ================= CONFIG ================= */

const TIMEZONE = "Europe/Paris";
const CONSULT_DURATION = 30;

/* ================= DATE FRANCE ================= */

function nowParis() {
  return new Date(
    new Date().toLocaleString("en-US", { timeZone: TIMEZONE })
  );
}

function createParisDate(year, month, day, hour, minute) {
  return new Date(year, month - 1, day, hour, minute, 0);
}

function formatFR(date) {
  return date.toLocaleString("fr-FR", {
    timeZone: TIMEZONE,
    dateStyle: "full",
    timeStyle: "short"
  });
}

/* ================= OPENAI ================= */

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/* ================= GOOGLE ================= */

const oAuth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

oAuth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN
});

const calendar = google.calendar({
  version: "v3",
  auth: oAuth2Client
});

/* ================= MEMOIRE ================= */

const conversations = {};

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
  res.send("Cabinet Dr Boutaam actif");
});

/* ================= APPEL ================= */

app.post("/voice", (req, res) => {

  const callSid = req.body.CallSid;
  const today = nowParis();

  conversations[callSid] = [
    {
      role: "system",
      content: `
Nous sommes le ${today.toLocaleDateString("fr-FR")} en France.
Fuseau horaire : Europe/Paris.

Tu es la secrétaire humaine du Docteur Boutaam.

RÈGLES :

- Consultation = 30 minutes.
- Si patient dit 9h → 09:00 EXACT.
- Format 24h uniquement.
- Toujours vérifier le créneau EXACT demandé.
- Ne jamais inventer de disponibilité.
- Si date absente → la déduire.
- Si date passée → proposer année suivante.
- Modification = suppression puis recréation.
- Aucun doublon.
- Toujours demander nom + motif si manquant.
- Être naturelle.

Balises :

[CREATE name="NOM" reason="MOTIF" date="YYYY-MM-DD" time="HH:MM"]
[DELETE name="NOM"]
[MODIFY name="NOM" reason="MOTIF" date="YYYY-MM-DD" time="HH:MM"]

Ne lis jamais les balises.
`
    }
  ];

  res.type("text/xml");
  res.send(buildTwiML("Cabinet médical du Docteur Boutaam, bonjour. Comment puis-je vous aider ?"));
});

/* ================= TRAITEMENT ================= */

app.post("/process-speech", async (req, res) => {

  const speech = (req.body.SpeechResult || "").trim();
  const callSid = req.body.CallSid;

  if (!speech) {
    return res.type("text/xml").send(buildTwiML("Je ne vous entends plus. Bonne journée."));
  }

  conversations[callSid].push({ role: "user", content: speech });

  try {

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: conversations[callSid]
    });

    let reply = completion.choices[0].message.content;

    /* ================= CREATE ================= */

    const createMatch = reply.match(/\[CREATE name="([^"]+)" reason="([^"]+)" date="([^"]+)" time="([^"]+)"\]/);

    if (createMatch) {

      const name = createMatch[1];
      const reason = createMatch[2];
      const [year, month, day] = createMatch[3].split("-");
      const [hour, minute] = createMatch[4].split(":");

      const start = createParisDate(year, month, day, hour, minute);
      const end = new Date(start.getTime() + CONSULT_DURATION * 60000);

      // Vérification EXACTE
      const existing = await calendar.events.list({
        calendarId: "primary",
        timeMin: start.toISOString(),
        timeMax: end.toISOString(),
        singleEvents: true
      });

      if (existing.data.items.length > 0) {

        reply = "Ce créneau n'est pas disponible. Souhaitez-vous un autre horaire ?";

      } else {

        // Supprime ancien RDV même nom
        const previous = await calendar.events.list({
          calendarId: "primary",
          q: name,
          singleEvents: true
        });

        for (let event of previous.data.items) {
          await calendar.events.delete({
            calendarId: "primary",
            eventId: event.id
          });
        }

        await calendar.events.insert({
          calendarId: "primary",
          resource: {
            summary: `Consultation - ${name}`,
            description: `Patient : ${name}\nMotif : ${reason}`,
            start: {
              dateTime: start.toISOString(),
              timeZone: TIMEZONE
            },
            end: {
              dateTime: end.toISOString(),
              timeZone: TIMEZONE
            }
          }
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
        singleEvents: true
      });

      if (events.data.items.length === 0) {
        reply = "Je ne trouve aucun rendez-vous à votre nom.";
      } else {
        for (let event of events.data.items) {
          await calendar.events.delete({
            calendarId: "primary",
            eventId: event.id
          });
        }
        reply = "Votre rendez-vous a été supprimé.";
      }
    }

    /* ================= MODIFY ================= */

    const modifyMatch = reply.match(/\[MODIFY name="([^"]+)" reason="([^"]+)" date="([^"]+)" time="([^"]+)"\]/);

    if (modifyMatch) {

      const name = modifyMatch[1];
      const reason = modifyMatch[2];
      const [year, month, day] = modifyMatch[3].split("-");
      const [hour, minute] = modifyMatch[4].split(":");

      const start = createParisDate(year, month, day, hour, minute);
      const end = new Date(start.getTime() + CONSULT_DURATION * 60000);

      // Supprime ancien
      const previous = await calendar.events.list({
        calendarId: "primary",
        q: name,
        singleEvents: true
      });

      for (let event of previous.data.items) {
        await calendar.events.delete({
          calendarId: "primary",
          eventId: event.id
        });
      }

      await calendar.events.insert({
        calendarId: "primary",
        resource: {
          summary: `Consultation - ${name}`,
          description: `Patient : ${name}\nMotif : ${reason}`,
          start: { dateTime: start.toISOString(), timeZone: TIMEZONE },
          end: { dateTime: end.toISOString(), timeZone: TIMEZONE }
        }
      });

      reply = `Votre rendez-vous a été déplacé au ${formatFR(start)}.`;
    }

    reply = reply.replace(/\[.*?\]/g, "").trim();

    res.type("text/xml");
    res.send(buildTwiML(reply));

  } catch (error) {
    res.type("text/xml");
    res.send(buildTwiML("Une erreur technique est survenue."));
  }
});

/* ================= SERVER ================= */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Secrétariat Dr Boutaam actif sur port " + PORT);
});

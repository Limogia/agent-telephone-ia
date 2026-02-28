const express = require("express");
const { google } = require("googleapis");
const OpenAI = require("openai");

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

/* ================= CONFIG ================= */

const CONSULT_DURATION = 30; // minutes
const TIMEZONE = "Europe/Paris";
const CURRENT_DATE = "28/02/2026";

/* ================= OUTILS DATE FR ================= */

function nowParis() {
  return new Date(
    new Date().toLocaleString("en-US", { timeZone: TIMEZONE })
  );
}

function formatDateFR(dateObj) {
  return dateObj.toLocaleString("fr-FR", {
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
const sessions = {}; // stocke nom + motif pendant appel

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

  sessions[callSid] = {
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

Règles métier :

- Consultation = 30 minutes.
- Tu dois demander le nom du patient.
- Tu dois demander le motif.
- Si date absente, la déduire intelligemment.
- Si doute → demander précision.
- Toujours format 24h (ex : 10:00, jamais 12 PM).
- Toujours format date YYYY-MM-DD.
- Si année absente → utiliser 2026.
- Si date passée en 2026 → proposer 2027.

Gestion agenda :
- Si créneau occupé → proposer le plus proche disponible.
- Pour modification → supprimer ancien puis recréer.
- Pour suppression → vérifier que le nom correspond.
- Un patient ne peut pas supprimer un RDV d’un autre.

Quand tout est prêt :

[CREATE date="YYYY-MM-DD" time="HH:MM"]
[DELETE name="NOM PATIENT"]
[MODIFY name="NOM PATIENT" date="YYYY-MM-DD" time="HH:MM"]

Ne lis jamais les balises.
Tu es naturelle, intelligente, avec de la répartie.
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

    const createMatch = reply.match(/\[CREATE date="([^"]+)" time="([^"]+)"\]/);

    if (createMatch) {
      const date = createMatch[1];
      const time = createMatch[2];

      const [y, m, d] = date.split("-");
      const [hh, mm] = time.split(":");

      const start = new Date(y, m - 1, d, hh, mm);
      const end = new Date(start.getTime() + CONSULT_DURATION * 60000);

      const existing = await calendar.events.list({
        calendarId: "primary",
        timeMin: start.toISOString(),
        timeMax: end.toISOString(),
        singleEvents: true,
      });

      if (existing.data.items.length > 0) {

        // Propose prochain créneau libre
        let newStart = new Date(start);
        let found = false;

        for (let i = 1; i <= 8; i++) {
          newStart = new Date(start.getTime() + i * CONSULT_DURATION * 60000);
          const newEnd = new Date(newStart.getTime() + CONSULT_DURATION * 60000);

          const check = await calendar.events.list({
            calendarId: "primary",
            timeMin: newStart.toISOString(),
            timeMax: newEnd.toISOString(),
            singleEvents: true,
          });

          if (check.data.items.length === 0) {
            reply = `Le créneau demandé est indisponible. Je peux vous proposer le ${formatDateFR(newStart)}. Cela vous convient-il ?`;
            found = true;
            break;
          }
        }

        if (!found) {
          reply = "Je n'ai malheureusement pas de disponibilité proche. Souhaitez-vous un autre jour ?";
        }

      } else {
        await calendar.events.insert({
          calendarId: "primary",
          resource: {
            summary: `Consultation - ${sessions[callSid]?.name || "Patient"}`,
            description: `Motif : ${sessions[callSid]?.reason || "Non précisé"}`,
            start: { dateTime: start.toISOString(), timeZone: TIMEZONE },
            end: { dateTime: end.toISOString(), timeZone: TIMEZONE },
          },
        });

        reply = `Votre rendez-vous est confirmé pour le ${formatDateFR(start)}.`;
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
        reply = "Je ne trouve aucun rendez-vous à ce nom.";
      } else {
        await calendar.events.delete({
          calendarId: "primary",
          eventId: events.data.items[0].id,
        });

        reply = "Votre rendez-vous a bien été supprimé.";
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
            start: { dateTime: start.toISOString(), timeZone: TIMEZONE },
            end: { dateTime: end.toISOString(), timeZone: TIMEZONE },
          },
        });

        reply = `Votre rendez-vous a été modifié au ${formatDateFR(start)}.`;
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

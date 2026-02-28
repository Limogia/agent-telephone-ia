const express = require("express");
const { google } = require("googleapis");
const OpenAI = require("openai");
const twilio = require("twilio");

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

/* ================= CONFIG ================= */

const TIMEZONE = "Europe/Paris";
const CONSULT_DURATION = 30;

/* ================= TWILIO SMS CONFIG ================= */

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

async function sendConfirmationSMS(to, message) {
  try {
    await twilioClient.messages.create({
      messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
      to: to,
      body: message
    });

    console.log("SMS envoyé avec succès à " + to);
  } catch (error) {
    console.error("Erreur envoi SMS:", error.message);
  }
}

/* ================= DATE PARIS ================= */

function nowParis() {
  return new Date(
    new Date().toLocaleString("en-US", { timeZone: TIMEZONE })
  );
}

function createParisDate(year, month, day, hour, minute) {

  const now = nowParis();
  let finalYear = parseInt(year);

  if (!finalYear || finalYear < now.getFullYear()) {
    finalYear = now.getFullYear();
  }

  let date = new Date(finalYear, month - 1, day, hour, minute, 0);

  if (date < now) {
    date = new Date(finalYear + 1, month - 1, day, hour, minute, 0);
  }

  return date;
}

function formatFR(date) {
  return date.toLocaleString("fr-FR", {
    timeZone: TIMEZONE,
    dateStyle: "full",
    timeStyle: "short"
  });
}

/* ================= HORAIRES CABINET ================= */

function isCabinetOpen(date) {
  const day = date.getDay();
  const hour = date.getHours();

  if (day === 0) return false;

  if (day >= 1 && day <= 5) {
    return hour >= 8 && hour < 18;
  }

  if (day === 6) {
    return hour >= 8 && hour < 12;
  }

  return false;
}

function nextOpeningSlot(date) {
  let test = new Date(date);

  while (!isCabinetOpen(test)) {
    test = new Date(test.getTime() + CONSULT_DURATION * 60000);
  }

  return test;
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

/* ================= ETAT STRUCTURE (AJOUT) ================= */

const callState = {};

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
Fuseau horaire officiel : Europe/Paris.

Tu es la secrétaire humaine du Docteur Boutaam.

RÈGLES :

- Consultation = 30 minutes.
- Heure EXACTE demandée (9h = 09:00).
- Format 24h uniquement.
- Toujours vérifier le créneau EXACT demandé.
- Ne jamais inventer une disponibilité.
- Modification = suppression puis recréation.
- Aucun doublon.
- Toujours demander nom + motif si manquant.
- Cabinet ouvert :
  - Lundi à vendredi 8h–18h
  - Samedi 8h–12h
  - Dimanche fermé

GESTION DES DATES :

- Si l'année n'est PAS précisée → utiliser l'année actuelle.
- Si la date demandée est déjà passée → utiliser l'année suivante.
- Toujours raisonner en Europe/Paris.
- Vérifier que le jour correspond au vrai calendrier.

STRUCTURE OBLIGATOIRE :

1. Demander le motif UNE SEULE FOIS.
2. Ensuite demander la date et l'heure.
3. Ensuite créer le rendez-vous.
4. Ne jamais redemander une information déjà obtenue.
5. Ne jamais recommencer la conversation.
6. Ne jamais poser deux fois la même question.

Balises :

[CREATE name="NOM" reason="MOTIF" date="YYYY-MM-DD" time="HH:MM"]
[DELETE name="NOM"]
[MODIFY name="NOM" reason="MOTIF" date="YYYY-MM-DD" time="HH:MM"]

Ne lis jamais les balises.
`
    }
  ];

  /* ===== INITIALISATION ETAT ===== */

  callState[callSid] = {
    step: "ASK_REASON"
  };

  res.type("text/xml");
  res.send(buildTwiML("Cabinet médical du Docteur Boutaam, bonjour. Quel est le motif de votre rendez-vous ?"));
});

/* ================= TRAITEMENT ================= */

app.post("/process-speech", async (req, res) => {

  const speech = (req.body.SpeechResult || "").trim();
  const callSid = req.body.CallSid;
  const callerNumber = req.body.From;

  if (!speech) {
    return res.type("text/xml").send(buildTwiML("Je ne vous entends plus. Bonne journée."));
  }

  const state = callState[callSid];

  /* ===== STRUCTURE CONVERSATION (AJOUT) ===== */

  if (state && state.step === "ASK_REASON") {
    state.reason = speech;
    state.step = "ASK_DATETIME";
    return res.type("text/xml").send(
      buildTwiML("Merci. Quelle date et heure souhaitez-vous ?")
    );
  }

  conversations[callSid].push({ role: "user", content: speech });

  try {

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: conversations[callSid]
    });

    let reply = completion.choices[0].message.content;

    const createMatch = reply.match(/\[CREATE name="([^"]+)" reason="([^"]+)" date="([^"]+)" time="([^"]+)"\]/);

    if (createMatch) {

      const name = createMatch[1];
      const reason = createMatch[2];

      let parts = createMatch[3].split("-");
      let year = parts[0];
      let month = parts[1];
      let day = parts[2];

      const [hour, minute] = createMatch[4].split(":");

      let start = createParisDate(year, month, day, hour, minute);

      if (!isCabinetOpen(start)) {
        const proposal = nextOpeningSlot(start);
        reply = `Le cabinet est fermé à cet horaire. Je peux vous proposer le ${formatFR(proposal)}. Cela vous convient-il ?`;
      } else {

        const end = new Date(start.getTime() + CONSULT_DURATION * 60000);

        const existing = await calendar.events.list({
          calendarId: "primary",
          timeMin: start.toISOString(),
          timeMax: end.toISOString(),
          singleEvents: true
        });

        if (existing.data.items.length > 0) {
          reply = "Ce créneau est déjà réservé. Souhaitez-vous un autre horaire ?";
        } else {

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

          reply = `Votre rendez-vous est confirmé le ${formatFR(start)}.`;

          await sendConfirmationSMS(
            callerNumber,
            `Bonjour ${name}, votre rendez-vous est confirmé le ${formatFR(start)} avec le Dr Boutaam.`
          );

          /* ===== RESET ETAT POUR EVITER BOUCLE ===== */

          delete callState[callSid];
        }
      }
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

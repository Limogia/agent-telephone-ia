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

/* ================= TWILIO ================= */

const smsClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

/* ================= DATE PARIS ================= */

function nowParis() {
  return new Date(
    new Date().toLocaleString("en-US", { timeZone: TIMEZONE })
  );
}

function createLocalDate(year, month, day, hour, minute) {
  return new Date(year, month - 1, day, hour, minute, 0);
}

function formatFR(date) {
  return date.toLocaleString("fr-FR", {
    timeZone: TIMEZONE,
    dateStyle: "full",
    timeStyle: "short"
  });
}

/* ================= HORAIRES CABINET ================= */

function isOpen(date) {
  const day = date.getDay(); // 0 = dimanche
  const hour = date.getHours();

  if (day === 0) return false;
  if (day >= 1 && day <= 5) return hour >= 8 && hour < 18;
  if (day === 6) return hour >= 8 && hour < 12;

  return false;
}

function nextOpenSlot(date) {
  let test = new Date(date);
  while (!isOpen(test)) {
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

Vous êtes la secrétaire professionnelle du Docteur Boutaam.

RÈGLES STRICTES :

- Consultation = 30 minutes.
- Heure EXACTE demandée.
- Ne jamais modifier l'heure donnée.
- Ne jamais ajouter +1h.
- Ne jamais annoncer un jour de la semaine sans que le serveur le calcule.
- Toujours vérifier le créneau exact demandé.
- Ne jamais inventer une disponibilité.
- Aucun doublon.
- Toujours utiliser le vouvoiement.
- Demander nom + motif si manquants.

Balises :

[CREATE name="NOM" reason="MOTIF" date="YYYY-MM-DD" time="HH:MM"]
[DELETE name="NOM"]
[MODIFY name="NOM" reason="MOTIF" date="YYYY-MM-DD" time="HH:MM"]

Ne jamais lire les balises.
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
  const callerNumber = req.body.From;

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

      const start = createLocalDate(year, month, day, hour, minute);
      const end = new Date(start.getTime() + CONSULT_DURATION * 60000);

      const startString = `${year}-${month}-${day}T${hour}:${minute}:00`;
      const endString = `${year}-${month}-${day}T${end.getHours().toString().padStart(2,"0")}:${end.getMinutes().toString().padStart(2,"0")}:00`;

      if (!isOpen(start)) {
        const proposal = nextOpenSlot(start);
        reply = `Le cabinet est fermé à cet horaire. Je peux vous proposer le ${formatFR(proposal)}.`;
      } else {

        const existing = await calendar.events.list({
          calendarId: "primary",
          timeMin: startString,
          timeMax: endString,
          singleEvents: true,
          timeZone: TIMEZONE
        });

        if (existing.data.items.length > 0) {
          reply = "Ce créneau est déjà réservé. Souhaitez-vous un autre horaire ?";
        } else {

          await calendar.events.insert({
            calendarId: "primary",
            resource: {
              summary: `Consultation - ${name}`,
              description: `Patient : ${name}\nMotif : ${reason}`,
              start: { dateTime: startString, timeZone: TIMEZONE },
              end: { dateTime: endString, timeZone: TIMEZONE }
            }
          });

          reply = `Votre rendez-vous est confirmé le ${formatFR(start)}.`;

          await smsClient.messages.create({
            messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
            to: callerNumber,
            body: `Cabinet Dr Boutaam : Votre rendez-vous est confirmé le ${formatFR(start)}.`
          });
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Secrétariat Dr Boutaam actif sur port " + PORT);
});

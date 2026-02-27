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

/* ================= MÉMOIRE ================= */

const conversations = {};

/* ================= ROUTES ================= */

app.get("/", (req, res) => {
  res.send("Serveur actif ✅");
});

/* ===== DÉMARRAGE ===== */

app.post("/voice", (req, res) => {
  const callSid = req.body.CallSid;

  conversations[callSid] = [
    {
      role: "system",
      content: `
Tu es une assistante téléphonique française naturelle.

Tu peux :
- créer un rendez-vous
- supprimer un rendez-vous
- modifier un rendez-vous
- vérifier la disponibilité

Quand une action est nécessaire, termine ta réponse par :

[CREATE date="YYYY-MM-DD" time="HH:MM"]
[DELETE date="YYYY-MM-DD" time="HH:MM"]
[UPDATE old_date="YYYY-MM-DD" old_time="HH:MM" new_date="YYYY-MM-DD" new_time="HH:MM"]
[CHECK date="YYYY-MM-DD" time="HH:MM"]

Sinon parle normalement.
Ne lis jamais ces balises à voix haute.
`,
    },
  ];

  res.type("text/xml");
  res.send(`
    <Response>
      <Gather input="speech" language="fr-FR" action="/process-speech" method="POST">
        <Say voice="Polly.Celine-Neural" language="fr-FR">
          Bonjour, comment puis-je vous aider aujourd'hui ?
        </Say>
      </Gather>
    </Response>
  `);
});

/* ===== CONVERSATION ===== */

app.post("/process-speech", async (req, res) => {
  const speech = req.body.SpeechResult || "";
  const callSid = req.body.CallSid;

  conversations[callSid].push({ role: "user", content: speech });

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: conversations[callSid],
    });

    let reply = completion.choices[0].message.content;

    /* ===== CREATE ===== */
    const createMatch = reply.match(/\[CREATE date="([^"]+)" time="([^"]+)"\]/);
    if (createMatch) {
      const date = createMatch[1];
      const time = createMatch[2];

      const start = new Date(`${date}T${time}:00`);

      await calendar.events.insert({
        calendarId: "primary",
        resource: {
          summary: "Rendez-vous client",
          start: { dateTime: start.toISOString(), timeZone: "Europe/Paris" },
          end: {
            dateTime: new Date(start.getTime() + 60 * 60 * 1000).toISOString(),
            timeZone: "Europe/Paris",
          },
        },
      });

      reply = reply.replace(/\[CREATE.*?\]/, "Votre rendez-vous est confirmé.");
    }

    /* ===== DELETE ===== */
    const deleteMatch = reply.match(/\[DELETE date="([^"]+)" time="([^"]+)"\]/);
    if (deleteMatch) {
      const date = deleteMatch[1];
      const time = deleteMatch[2];

      const start = new Date(`${date}T${time}:00`);

      const events = await calendar.events.list({
        calendarId: "primary",
        timeMin: start.toISOString(),
        timeMax: new Date(start.getTime() + 60 * 60 * 1000).toISOString(),
      });

      if (events.data.items.length > 0) {
        await calendar.events.delete({
          calendarId: "primary",
          eventId: events.data.items[0].id,
        });
        reply = reply.replace(/\[DELETE.*?\]/, "Le rendez-vous a été supprimé.");
      } else {
        reply = reply.replace(/\[DELETE.*?\]/, "Je n'ai trouvé aucun rendez-vous à cette heure.");
      }
    }

    /* ===== UPDATE ===== */
    const updateMatch = reply.match(
      /\[UPDATE old_date="([^"]+)" old_time="([^"]+)" new_date="([^"]+)" new_time="([^"]+)"\]/
    );

    if (updateMatch) {
      const oldDate = updateMatch[1];
      const oldTime = updateMatch[2];
      const newDate = updateMatch[3];
      const newTime = updateMatch[4];

      const oldStart = new Date(`${oldDate}T${oldTime}:00`);

      const events = await calendar.events.list({
        calendarId: "primary",
        timeMin: oldStart.toISOString(),
        timeMax: new Date(oldStart.getTime() + 60 * 60 * 1000).toISOString(),
      });

      if (events.data.items.length > 0) {
        const event = events.data.items[0];
        const newStart = new Date(`${newDate}T${newTime}:00`);

        await calendar.events.update({
          calendarId: "primary",
          eventId: event.id,
          resource: {
            ...event,
            start: { dateTime: newStart.toISOString(), timeZone: "Europe/Paris" },
            end: {
              dateTime: new Date(newStart.getTime() + 60 * 60 * 1000).toISOString(),
              timeZone: "Europe/Paris",
            },
          },
        });

        reply = reply.replace(/\[UPDATE.*?\]/, "Le rendez-vous a été modifié.");
      } else {
        reply = reply.replace(/\[UPDATE.*?\]/, "Je n'ai trouvé aucun rendez-vous correspondant.");
      }
    }

    /* ===== CHECK ===== */
    const checkMatch = reply.match(/\[CHECK date="([^"]+)" time="([^"]+)"\]/);
    if (checkMatch) {
      const date = checkMatch[1];
      const time = checkMatch[2];

      const start = new Date(`${date}T${time}:00`);

      const events = await calendar.events.list({
        calendarId: "primary",
        timeMin: start.toISOString(),
        timeMax: new Date(start.getTime() + 60 * 60 * 1000).toISOString(),
      });

      if (events.data.items.length > 0) {
        reply = reply.replace(/\[CHECK.*?\]/, "Ce créneau est déjà pris.");
      } else {
        reply = reply.replace(/\[CHECK.*?\]/, "Ce créneau est disponible.");
      }
    }

    conversations[callSid].push({ role: "assistant", content: reply });

    res.type("text/xml");
    res.send(`
      <Response>
        <Gather input="speech" language="fr-FR" action="/process-speech" method="POST">
          <Say voice="Polly.Celine-Neural" language="fr-FR">
            ${reply}
          </Say>
        </Gather>
      </Response>
    `);

  } catch (error) {
    console.error(error);

    res.type("text/xml");
    res.send(`
      <Response>
        <Say voice="Polly.Celine-Neural" language="fr-FR">
          Désolé, une erreur est survenue. Pouvez-vous répéter ?
        </Say>
        <Gather input="speech" language="fr-FR" action="/process-speech" method="POST"/>
      </Response>
    `);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Serveur démarré sur le port " + PORT);
});

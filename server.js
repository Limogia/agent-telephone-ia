const express = require("express");
const { google } = require("googleapis");
const OpenAI = require("openai");

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

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

/* ====== DÉMARRAGE APPEL ====== */

app.post("/voice", (req, res) => {
  const callSid = req.body.CallSid;

  conversations[callSid] = [
    {
      role: "system",
      content: `
Tu es une assistante téléphonique française naturelle, chaleureuse et intelligente.
Tu peux discuter librement.
Si l'utilisateur veut prendre un rendez-vous, tu dois répondre avec ce format exact à la fin :

[CREATE_EVENT date="YYYY-MM-DD" time="HH:MM"]

Sinon tu parles normalement.
Ne mentionne jamais ce format à voix haute.
`,
    },
  ];

  res.type("text/xml");
  res.send(`
    <Response>
      <Gather input="speech" language="fr-FR" action="/process-speech" method="POST">
        <Say voice="Polly.Celine-Neural" language="fr-FR">
          Bonjour, je suis votre assistante. Comment puis-je vous aider ?
        </Say>
      </Gather>
    </Response>
  `);
});

/* ====== CONVERSATION ====== */

app.post("/process-speech", async (req, res) => {
  const speech = req.body.SpeechResult || "";
  const callSid = req.body.CallSid;

  conversations[callSid].push({
    role: "user",
    content: speech,
  });

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: conversations[callSid],
    });

    let aiReply = completion.choices[0].message.content;

    conversations[callSid].push({
      role: "assistant",
      content: aiReply,
    });

    /* ====== DÉTECTION RENDEZ-VOUS ====== */

    const match = aiReply.match(
      /\[CREATE_EVENT date="([^"]+)" time="([^"]+)"\]/
    );

    if (match) {
      const date = match[1];
      const time = match[2];

      const startDateTime = new Date(`${date}T${time}:00`);

      await calendar.events.insert({
        calendarId: "primary",
        resource: {
          summary: "Rendez-vous client",
          start: {
            dateTime: startDateTime.toISOString(),
            timeZone: "Europe/Paris",
          },
          end: {
            dateTime: new Date(startDateTime.getTime() + 60 * 60 * 1000).toISOString(),
            timeZone: "Europe/Paris",
          },
        },
      });

      aiReply = aiReply.replace(
        /\[CREATE_EVENT.*?\]/,
        "Parfait, votre rendez-vous est bien confirmé."
      );
    }

    res.type("text/xml");
    res.send(`
      <Response>
        <Gather input="speech" language="fr-FR" action="/process-speech" method="POST">
          <Say voice="Polly.Celine-Neural" language="fr-FR">
            ${aiReply}
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
          Désolé, j'ai rencontré une petite erreur. Pouvez-vous répéter ?
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

import express from "express";
import OpenAI from "openai";
import twilio from "twilio";

const { VoiceResponse } = twilio.twiml;

const app = express();
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.get("/", (req, res) => {
  res.send("Serveur agent IA actif 🚀");
});

app.post("/voice", async (req, res) => {
  const twiml = new VoiceResponse();

  const userSpeech = req.body.SpeechResult || "";

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `
Tu es l’assistante téléphonique chaleureuse d’un cabinet médical.

Tu parles calmement et de manière rassurante.
Tu fais des phrases courtes.
Une seule question à la fois.

Tu peux :
- Programmer un rendez-vous
- Annuler un rendez-vous
- Prendre un message
- Répondre aux questions simples

En cas d'urgence médicale, demande d'appeler le 15.

Commence naturellement la conversation.
`
      },
      {
        role: "user",
        content: userSpeech
      }
    ]
  });

  const responseText = completion.choices[0].message.content;

  twiml.say(
    { voice: "alice", language: "fr-FR" },
    responseText
  );

  twiml.gather({
    input: "speech",
    action: "/voice",
    method: "POST"
  });

  res.type("text/xml");
  res.send(twiml.toString());
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

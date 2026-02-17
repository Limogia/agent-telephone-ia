import express from "express";
import OpenAI from "openai";
import twilio from "twilio";

const { VoiceResponse } = twilio.twiml;

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const PORT = process.env.PORT || 3000;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// 🔹 Test simple serveur
app.get("/", (req, res) => {
  res.send("Serveur agent IA actif 🚀");
});

// 🔹 Test OpenAI sans Twilio
app.get("/test", async (req, res) => {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `
Tu es l’assistante téléphonique chaleureuse d’un cabinet médical.

Tu parles calmement, de manière rassurante et professionnelle.
Tu fais des phrases courtes.
Une seule question à la fois.

Tu peux :
- Programmer un rendez-vous
- Annuler un rendez-vous
- Prendre un message
- Répondre aux questions simples

Ne donne jamais d’avis médical.
En cas d'urgence, demande d'appeler le 15.
`
        },
        {
          role: "user",
          content: "Bonjour, je voudrais prendre rendez-vous demain matin."
        }
      ]
    });

    res.send(completion.choices[0].message.content);

  } catch (error) {
    console.error(error);
    res.send("Erreur OpenAI ❌");
  }
});

// 🔹 Route pour Twilio (appel vocal)
app.post("/voice", async (req, res) => {
  const twiml = new VoiceResponse();

  try {
    con


app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

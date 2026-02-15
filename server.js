const express = require("express");
const VoiceResponse = require("twilio").twiml.VoiceResponse;

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Serveur agent IA actif 🚀");
});

app.post("/voice", (req, res) => {
  const twiml = new VoiceResponse();

  twiml.say(
    { voice: "alice", language: "fr-FR" },
    "Bonjour, je suis votre assistant intelligent. Comment puis-je vous aider ?"
  );

  twiml.gather({
    input: "speech",
    action: "/process",
    method: "POST",
    language: "fr-FR",
  });

  res.type("text/xml");
  res.send(twiml.toString());
});

app.post("/process", (req, res) => {
  const userSpeech = req.body.SpeechResult || "";
  const twiml = new VoiceResponse();

  if (userSpeech.toLowerCase().includes("rendez")) {
    twiml.say(
      { voice: "alice", language: "fr-FR" },
      "Très bien, je vais vérifier les disponibilités."
    );
  } else {
    twiml.say(
      { voice: "alice", language: "fr-FR" },
      "Je n'ai pas bien compris, pouvez-vous répéter ?"
    );
  }

  res.type("text/xml");
  res.send(twiml.toString());
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

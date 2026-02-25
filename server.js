const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: false }));

app.get("/", (req, res) => {
  res.send("OK");
});

app.post("/voice", (req, res) => {
  console.log("📞 Appel Twilio reçu");

  res.set("Content-Type", "text/xml");
  res.status(200).send(`
<Response>
  <Say voice="alice" language="fr-FR">
    Bonjour, votre serveur fonctionne correctement.
  </Say>
</Response>
  `);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("Listening on " + PORT);
});

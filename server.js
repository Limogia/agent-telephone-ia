const express = require("express");

const app = express();

// Important pour Twilio (form-urlencoded)
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Route test racine
app.get("/", (req, res) => {
  res.send("Serveur actif ✅");
});

// Webhook Twilio Voice
app.post("/voice", (req, res) => {
  console.log("📞 Twilio webhook reçu");

  res.set("Content-Type", "text/xml");
  res.status(200).send(`
<Response>
  <Say voice="alice" language="fr-FR">
    Railway fonctionne correctement.
  </Say>
</Response>
  `);
});

// ⚠️ IMPORTANT POUR RAILWAY
const PORT = process.env.PORT || 8080;

app.listen(PORT, "0.0.0.0", () => {
  console.log("🚀 Server running on port " + PORT);
});

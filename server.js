const express = require("express");

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.urlencoded({ extended: false }));

app.post("/voice", (req, res) => {
  console.log("📞 Twilio a appelé");

  res.set("Content-Type", "text/xml");
  res.status(200).send(`
<Response>
  <Say voice="alice" language="fr-FR">
    Serveur Railway fonctionnel.
  </Say>
</Response>
  `);
});

app.get("/", (req, res) => {
  res.send("OK");
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("Server running on port " + PORT);
});

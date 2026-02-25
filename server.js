const express = require("express");

const app = express();
const PORT = process.env.PORT || 8080;

app.get("/", (req, res) => {
  res.status(200).send("OK");
});

app.post("/voice", (req, res) => {
  res.set("Content-Type", "text/xml");
  res.status(200).send(`
<Response>
  <Say voice="alice" language="fr-FR">
    Serveur Railway stable.
  </Say>
</Response>
  `);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("Listening on " + PORT);
});

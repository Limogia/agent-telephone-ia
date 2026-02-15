const express = require("express");
const app = express();

const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: false }));

app.post("/", (req, res) => {
  res.type("text/xml");
  res.send(`
    <Response>
      <Say voice="alice">Bonjour. Votre agent IA est maintenant actif.</Say>
    </Response>
  `);
});

app.get("/", (req, res) => {
  res.send("Serveur agent IA actif 🚀");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

const express = require("express");
const twilio = require("twilio");
const { google } = require("googleapis");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

/* ================= GOOGLE OAUTH ================= */

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

oauth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
});

/* ================= ROOT ================= */

app.get("/", (req, res) => {
  res.send("Serveur actif ✅");
});

/* ================= VOICE (TEST TEMPORAIRE) ================= */

app.all("/voice", (req, res) => {
  console.log("📞 REQUETE VOICE RECUE:", req.method);

  res.type("text/xml");
  res.send(`
<Response>
  <Say voice="alice" language="fr-FR">
    Bonjour, ceci est un test vocal.
  </Say>
</Response>
  `);
});

/* ================= SMS ================= */

app.post("/sms", (req, res) => {
  console.log("📩 SMS RECU:", req.body.Body);

  res.type("text/xml");
  res.send(`
<Response>
  <Message>Message bien reçu 👌</Message>
</Response>
  `);
});

/* ================= START SERVER ================= */

app.listen(PORT, () => {
  console.log("🚀 Server running on port " + PORT);
});

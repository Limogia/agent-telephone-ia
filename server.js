const express = require("express");
const { google } = require("googleapis");

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration OAuth Google
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// Route test
app.get("/", (req, res) => {
  res.send("Serveur actif ✅");
});

// Route connexion Google
app.get("/auth/google", (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/calendar"],
  });

  res.redirect(url);
});

// Callback Google
app.get("/auth/google/callback", async (req, res) => {
  try {
    const code = req.query.code;
    const { tokens } = await oauth2Client.getToken(code);

    console.log("REFRESH TOKEN:", tokens.refresh_token);

    res.send("Google Calendar connecté ✅ Regarde les logs Railway.");
  } catch (error) {
    console.error(error);
    res.send("Erreur connexion Google");
  }
});

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});

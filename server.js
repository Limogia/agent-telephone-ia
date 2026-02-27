const express = require("express");
const { google } = require("googleapis");

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

/* =========================
   GOOGLE OAUTH CONFIG
========================= */

const oAuth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

oAuth2Client.setCredentials({
  refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
});

const calendar = google.calendar({
  version: "v3",
  auth: oAuth2Client,
});

async function createEvent() {
  const event = {
    summary: "Rendez-vous client",
    start: {
      dateTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      timeZone: "Europe/Paris",
    },
    end: {
      dateTime: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      timeZone: "Europe/Paris",
    },
  };

  await calendar.events.insert({
    calendarId: "primary",
    resource: event,
  });
}

/* =========================
   ROUTES
========================= */

app.get("/", (req, res) => {
  res.send("Serveur actif ✅");
});

app.post("/voice", async (req, res) => {
  res.set("Content-Type", "text/xml");

  try {
    await createEvent();

    res.send(`
      <?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Say>Votre rendez-vous a été ajouté au calendrier.</Say>
      </Response>
    `);
  } catch (error) {
    console.error(error);

    res.send(`
      <?xml version="1.0" encoding="UTF-8"?>
      <Response>
        <Say>Une erreur est survenue.</Say>
      </Response>
    `);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Serveur démarré sur le port " + PORT);
});

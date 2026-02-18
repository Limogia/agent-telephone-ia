import express from "express";
import { google } from "googleapis";

const app = express();
const PORT = process.env.PORT || 3000;

/* ===============================
   GOOGLE CALENDAR CONFIG
================================= */

const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ["https://www.googleapis.com/auth/calendar"]
});

const calendar = google.calendar({
  version: "v3",
  auth
});

/* ===============================
   ROUTES
================================= */

app.get("/", (req, res) => {
  res.send("Serveur actif 🚀");
});

app.get("/calendar-test", async (req, res) => {
  try {
    const event = {
      summary: "Test RDV IA",
      description: "Rendez-vous créé automatiquement par l'agent IA",
      start: {
        dateTime: new Date().toISOString(),
        timeZone: "Europe/Paris"
      },
      end: {
        dateTime: new Date(Date.now() + 30 * 60000).toISOString(),
        timeZone: "Europe/Paris"
      }
    };

    const response = await calendar.events.insert({
      calendarId: "primary",
      resource: event
    });

    res.send("Événement créé ✅");

  } catch (error) {
    console.error(error);
    res.status(500).send("Erreur Google Calendar ❌");
  }
});

/* ===============================
   START SERVER
================================= */

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});

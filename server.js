import express from "express";
import OpenAI from "openai";
import twilio from "twilio";
import { google } from "googleapis";

const { VoiceResponse } = twilio.twiml;

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const PORT = process.env.PORT || 3000;

/* =======================
   OPENAI CONFIG
======================= */

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/* =======================
   GOOGLE CALENDAR CONFIG
======================= */

const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ["https://www.googleapis.com/auth/calendar"]
});

const calendar = google.calendar({ version: "v3", auth });

/* =======================
   ROUTES
======================= */

app.get("/", (req, res) => {
  res.send("Serveur actif");
});

/* ===== TEST CALENDAR ===== */

app.get("/calendar-test", async (req, res) => {
  try {
    const event = {
      summary: "Test RDV IA",
      description: "Rendez-vous créé automatiquement par l'agent IA",
      start: {
        dateTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        timeZone: "Europe/Paris"
      },
      end: {
        dateTime: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        timeZone: "Europe/Paris"
      }
    };

    const response = await calendar.events.insert({
      calendarId: "primary",
      requestBody: event
    });

    res.send("✅ Événement créé : " + response.data.htmlLink);

  } catch (error) {
    console.error(error);
    res.status(500).send("❌ Erreur Calendar");
  }
});

/* ===== VOICE TWILIO ===== */

app.post("/voice", async (req, res) => {
  const twiml = new VoiceResponse();

  try {
    const userSpeech = req.body.SpeechResult || "";

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "Tu es un assistant médical. Réponses courtes." },
        { role: "user", content: userSpeech }
      ]
    });

    const responseText = completion.choices[0].message.content;

    twiml.say({ voice: "alice", language: "fr-FR" }, responseText);

    twiml.gather({
      input: "speech",
      action: "/voice",
      method: "POST"
    });

  } catch (error) {
    console.error(error);
    twiml.say("Une erreur est survenue.");
  }

  res.type("text/xml");
  res.send(twiml.toString());
});

app.listen(PORT, () => {
  console.log("Server running");
});

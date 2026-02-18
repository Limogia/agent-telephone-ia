import express from "express";
import OpenAI from "openai";
import twilio from "twilio";
import { google } from "googleapis";

const { VoiceResponse } = twilio.twiml;

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const PORT = process.env.PORT || 3000;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ["https://www.googleapis.com/auth/calendar"]
});

const calendar = google.calendar({ version: "v3", auth });

app.get("/", (req, res) => {
  res.send("Serveur actif");
});

app.get("/test", async (req, res) => {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a medical assistant." },
        { role: "user", content: "I want to book an appointment tomorrow morning." }
      ]
    });

    res.send(completion.choices[0].message.content);

  } catch (error) {
    console.error(error);
    res.send("OpenAI error");
  }
});

app.post("/voice", async (req, res) => {
  const twiml = new VoiceResponse();

  try {
    const userSpeech = req.body.SpeechResult || "";

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a medical assistant. Keep answers short." },
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
    twiml.say("An error occurred.");
  }

  res.type("text/xml");
  res.send(twiml.toString());
});

app.listen(PORT, () => {
  console.log("Server running");
});

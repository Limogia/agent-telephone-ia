import express from "express";
import OpenAI from "openai";
import twilio from "twilio";

const { VoiceResponse } = twilio.twiml;

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const PORT = process.env.PORT || 3000;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Route principale
app.get("/", (req, res) => {
  res.send("Serveur agent IA actif 🚀");
});

// Route test OpenAI
app.get("/test", async (req, res) => {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "Tu es une assistante médicale chaleureuse."
        },
        {
          role: "user",
          content: "Je voudrais

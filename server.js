const express = require("express");
const app = express();

app.post("/voice", (req, res) => {
  console.log("TWILIO HIT");
  res.set("Content-Type", "text/xml");
  res.send(`
<Response>
  <Say voice="alice">Test Railway direct</Say>
</Response>
  `);
});

app.get("/", (req, res) => {
  res.send("OK");
});

app.listen(process.env.PORT, () => {
  console.log("Server running");
});

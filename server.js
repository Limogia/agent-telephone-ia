const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

// IMPORTANT
app.listen(PORT, "0.0.0.0", () => {
  console.log("Listening on " + PORT);
});

app.get("/", (req, res) => {
  res.status(200).send("OK");
});

const express = require("express");

const app = express();

app.get("/", (req, res) => {
  res.status(200).send("OK");
});

app.listen(process.env.PORT, "0.0.0.0", () => {
  console.log("Listening on " + process.env.PORT);
});

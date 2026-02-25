const express = require("express");

const app = express();
const PORT = process.env.PORT;

app.get("/", (req, res) => {
  res.send("Railway OK");
});

app.listen(PORT, () => {
  console.log("Listening on " + PORT);
});

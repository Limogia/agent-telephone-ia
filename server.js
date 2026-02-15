const express = require("express");
const app = express();

const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get("/", (req, res) => {
  res.send("Serveur agent IA actif 🚀");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

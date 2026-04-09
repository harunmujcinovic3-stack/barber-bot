import express from "express";

const app = express();

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.get("/", (req, res) => {
  res.send("bot is live 🔥");
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.post("/webhook/twilio", (req, res) => {
  console.log("incoming message:", req.body);

  res.send(`
    <Response>
      <Message>yo bro het werkt 💈</Message>
    </Response>
  `);
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("server running on " + PORT);
});
require('dotenv').config({ override: false });

if (!process.env.OPENAI_API_KEY) {
  console.error("❌ OPENAI_API_KEY est introuvable !");
  process.exit(1); // arrête le serveur si la clé est absente
}

const express = require('express');
const cors = require('cors');
const session = require('express-session');
const bodyParser = require('body-parser');
const { Configuration, OpenAIApi } = require("openai");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(bodyParser.json());
app.use(cors({ origin: "*", credentials: true }));
app.use(session({
  secret: 'secret',
  resave: false,
  saveUninitialized: true,
}));

app.post('/api/ameliorer', async (req, res) => {
  try {
    const texte = req.body.texte;
    if (!texte) return res.status(400).json({ error: "Pas de texte fourni" });

    const prompt = `
Tu es un assistant qui analyse des factures de supermarchés. Retourne un JSON comme :
{
  "store": "Nom du magasin",
  "address": "Adresse",
  "date": "YYYY-MM-DD",
  "items": [
    {
      "description": "Nom produit",
      "quantity": "Quantité ou null",
      "unit_price": "Prix unitaire ou null",
      "total_price": "Prix total"
    }
  ],
  "total": "Montant total"
}
Voici le texte :
\`\`\`
${texte}
\`\`\`
`;
   console.log("🔐 Clé OpenAI : ", process.env.OPENAI_API_KEY ? "OK" : "❌ Manquante");
    const configuration = new Configuration({
      apiKey: process.env.OPENAI_API_KEY,
    });

    try {
  const completion = await openai.createChatCompletion({
    model: "gpt-3.5-turbo",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.1,
  });
} catch (error) {
  console.error("❌ Erreur OpenAI :", error.response?.data || error.message);
  return res.status(500).json({ error: "Erreur OpenAI" });
}
    const raw = completion.data.choices[0].message.content;
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("❌ JSON invalide :", raw);
      return res.status(500).json({ error: "Réponse IA invalide" });
    }

    const data = JSON.parse(jsonMatch[0]);
    res.json(data);

  } catch (error) {
    console.error("❌ Erreur serveur :", error); // 👈 ajoute ceci
    res.status(500).json({ error: "Erreur interne" });
  }
});
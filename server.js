require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const session = require('express-session');
const { CohereClient } = require("cohere-ai");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(bodyParser.json());
app.use(cors({ origin: "*", credentials: true }));
app.use(session({
  secret: 'secret',
  resave: false,
  saveUninitialized: true,
}));

// ✅ Crée une instance de client Cohere (nouveau format)
const cohere = new CohereClient({
  token: process.env.COHERE_API_KEY,
});

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

    const response = await cohere.generate({
      model: 'command-r',
      prompt: prompt,
      maxTokens: 500,
      temperature: 0.2,
    });

    const raw = response.generations[0].text;
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(500).json({ error: "Réponse IA invalide" });

    const data = JSON.parse(jsonMatch[0]);
    res.json(data);
  } catch (error) {
    console.error("Erreur serveur :", error);
    res.status(500).json({ error: "Erreur interne IA" });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Serveur actif sur le port ${PORT}`);
});

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { Configuration, OpenAIApi } = require("openai");

const app = express();
const PORT = process.env.PORT || 10000;

// ✅ Vérifie si la clé API est bien définie
if (!process.env.OPENAI_API_KEY) {
  console.error("❌ ERREUR : La variable OPENAI_API_KEY est absente !");
  process.exit(1); // Stoppe l'app pour Render
}

app.use(bodyParser.json());
app.use(cors({ origin: "*", credentials: true }));

// ✅ Route IA
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

    const configuration = new Configuration({
      apiKey: process.env.OPENAI_API_KEY,
    });
    const openai = new OpenAIApi(configuration);

    const completion = await openai.createChatCompletion({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
    });

    const raw = completion.data.choices[0].message.content;
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(500).json({ error: "Réponse IA invalide" });

    const data = JSON.parse(jsonMatch[0]);
    res.json(data);
  } catch (error) {
    console.error("❌ Erreur serveur :", error?.response?.data || error.message);
    res.status(500).json({ error: "Erreur interne du serveur IA" });
  }
});

// ✅ Démarrage
app.listen(PORT, () => {
  console.log(`✅ Serveur actif sur http://localhost:${PORT}`);
});

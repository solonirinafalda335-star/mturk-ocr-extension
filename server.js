const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const cohere = require("cohere-ai");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 10000;

cohere.init(process.env.COHERE_API_KEY);

app.use(cors());
app.use(bodyParser.json());

app.post("/api/ia", async (req, res) => {
  const { texte } = req.body;

  try {
    const prompt = `Voici un texte brut OCR extrait d’une facture.\nRéponds uniquement avec un JSON strictement valide, sans aucun texte explicatif ni introduction.\n\nLe JSON doit contenir ces champs (mets null si absent) :\n- imageQuality : "Good quality image" ou "Poor quality image"\n- storeName\n- storePhone\n- storeAddress\n- purchaseDate\n- purchaseTime\n- totalPaid\n- products : tableau de produits avec "description", "code", "quantity" (number), "price" (number)\n\nTexte :\n${texte}`;

    const response = await cohere.generate({
      model: "command-r",
      prompt: prompt,
      max_tokens: 1000,
      temperature: 0.2,
    });

    const generation = response.body.generations[0].text.trim();

    // ⚠️ Essayer de parser et corriger si nécessaire
    try {
      const json = JSON.parse(generation);
      res.json({ json });
    } catch (err) {
      // 🛠️ Tentative de correction manuelle simple
      const cleaned = generation
        .replace(/,\s*([\]}])/g, '$1') // supprime virgules en trop
        .replace(/(\d+)\.(\d{3,})/g, (m, a, b) => `${a}.${b.slice(0, 2)}`); // arrondi à 2 décimales

      try {
        const json = JSON.parse(cleaned);
        res.json({ json });
      } catch (parseErr) {
        console.error("❌ JSON toujours invalide :", generation);
        res.status(400).json({ error: "Réponse IA invalide", raw: generation });
      }
    }
  } catch (error) {
    console.error("❌ Erreur IA :", error);
    res.status(500).json({ error: "Erreur serveur IA" });
  }
});

app.listen(port, () => {
  console.log(`✅ Serveur actif sur le port ${port}`);
});

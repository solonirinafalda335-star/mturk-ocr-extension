// server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import cohere from "cohere-ai";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

// 🔐 Initialise Cohere avec ta clé secrète
cohere.init(process.env.COHERE_API_KEY);

// 🎯 API pour améliorer le texte OCR
app.post("/api/ameliorer", async (req, res) => {
  try {
    const { texte } = req.body;

    if (!texte) {
      return res.status(400).json({ error: "Aucun texte fourni." });
    }

    const prompt = `
Tu es une IA experte en compréhension de tickets de caisse OCR. 
Corrige les erreurs d’OCR, supprime les artefacts inutiles, et organise le texte.
Rends le résultat dans ce format JSON :

{
  "magasin": "Nom du magasin",
  "produits": [
    {"description": "Nom produit 1", "prix": "1.00"},
    {"description": "Nom produit 2", "prix": "2.50"}
  ],
  "total": "3.50"
}

Voici le texte OCR :
"""${texte}"""
`;

    const response = await cohere.generate({
      model: "command", // ✅ modèle compatible avec generate
      prompt,
      max_tokens: 500,
      temperature: 0.3
    });

    const cleanedText = response.body.generations[0].text;
    res.json({ resultat: cleanedText });
  } catch (err) {
    console.error("Erreur serveur :", err);
    res.status(500).json({ error: "Erreur lors de la génération du texte." });
  }
});

// 🚀 Lance le serveur
app.listen(PORT, () => {
  console.log(`✅ Serveur actif sur le port ${PORT}`);
});

const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const cohere = require("cohere-ai");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

cohere.init(process.env.COHERE_API_KEY);

app.post("/api/ameliorer", async (req, res) => {
  try {
    const { texte } = req.body;
    if (!texte) return res.status(400).json({ error: "Aucun texte fourni." });

    const prompt = `
Corrige le texte OCR suivant et retourne un JSON structuré comme :
{
  "magasin": "Nom du magasin",
  "produits": [{"description": "...", "prix": "..." }],
  "total": "..."
}
Texte OCR :
"""${texte}"""
    `;

    const response = await cohere.generate({
      model: "command",
      prompt,
      max_tokens: 500,
      temperature: 0.3,
    });

    const cleanedText = response.body.generations[0].text;
    res.json({ resultat: cleanedText });
  } catch (err) {
    console.error("Erreur serveur :", err);
    res.status(500).json({ error: "Erreur serveur IA." });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Serveur en ligne sur le port ${PORT}`);
});

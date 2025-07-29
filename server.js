import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { CohereClient } from 'cohere-ai';

dotenv.config();

const app = express();
const port = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

// 🔍 Log de la clé pour vérifier que Render la voit bien (ne pas faire en prod)
console.log('🔑 Clé Cohere détectée ?', !!process.env.COHERE_API_KEY);

const cohere = new CohereClient({
  token: process.env.COHERE_API_KEY,
});

app.post('/api/enhance-text', async (req, res) => {
  try {
    const { text } = req.body;

    if (!text) {
      console.warn("❌ Requête sans 'text' !");
      return res.status(400).json({ error: 'Le champ "text" est requis' });
    }

    console.log("📩 Texte OCR reçu :", text.slice(0, 300) + '...');

    const prompt = `
Voici un texte brut OCR extrait d’une facture.
Merci de me fournir un JSON structuré avec les champs suivants :

- imageQuality : "Good quality image" ou "Poor quality image"
- storeName : nom du magasin (ex: Walmart) ou null
- storePhone : numéro de téléphone (chiffres uniquement) ou null
- storeAddress : adresse complète ou null
- purchaseDate : date d’achat au format mm/dd/yyyy ou null
- purchaseTime : heure d’achat au format HH:MM AM/PM ou null
- totalPaid : montant total payé ou null
- products : liste d’articles, chaque article contient :
  - description (texte)
  - code (texte ou chiffres)
  - quantity (nombre)
  - price (montant)

Si un champ est introuvable, mets null.
Renvoie uniquement le JSON, sans explications ni texte additionnel.

Texte OCR :
${text}
`;

    const response = await cohere.generate({
      model: 'command',
      prompt: prompt,
      max_tokens: 600,
      temperature: 0.3,
      stop_sequences: ["\n\n"],
    });

    console.log("✅ Réponse brute de Cohere reçue.");

    const rawText = response.generations?.[0]?.text?.trim();
    if (!rawText) {
      console.error("⚠️ Réponse IA vide ou mal formée :", response);
      return res.status(500).json({ error: "Réponse IA vide ou mal formée", response });
    }

    console.log("🧠 Texte IA retourné :", rawText.slice(0, 300) + '...');

    let jsonResult;
    try {
      jsonResult = JSON.parse(rawText);
    } catch (e) {
      console.error("❌ JSON invalide, texte brut IA :", rawText);
      return res.status(500).json({ error: 'Erreur parsing JSON IA', rawText });
    }

    res.json(jsonResult);
  } catch (error) {
    console.error('❌ Erreur serveur finale :', error);
    res.status(500).json({ error: 'Erreur lors de la génération Cohere', details: error.message });
  }
});

app.listen(port, () => {
  console.log(`✅ Serveur actif sur le port ${port}`);
});

const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { CohereClient } = require('cohere-ai');

dotenv.config();

const app = express();
const port = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

const cohere = new CohereClient({
  token: process.env.COHERE_API_KEY,
});

app.post('/api/enhance-text', async (req, res) => {
  try {
    const { text } = req.body;

    if (!text || typeof text !== 'string' || text.trim() === '') {
      return res.status(400).json({ error: 'Le champ "text" est requis et doit être une chaîne non vide' });
    }

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
      prompt,
      max_tokens: 600,
      temperature: 0.3,
      stop_sequences: ["\n\n"],
    });

    const rawText = response.generations?.[0]?.text?.trim();

    console.log('🔍 Réponse brute Cohere :', rawText);

    if (!rawText) {
      return res.status(500).json({ error: 'Réponse vide de Cohere' });
    }

    // Tenter d'extraire proprement un JSON même s'il y a du texte autour
    let jsonResult;
    try {
      // Trouver premier et dernier accolade pour extraire JSON
      const firstBrace = rawText.indexOf('{');
      const lastBrace = rawText.lastIndexOf('}');
      if (firstBrace === -1 || lastBrace === -1) {
        throw new Error('Pas de JSON détecté dans la réponse');
      }
      const jsonString = rawText.substring(firstBrace, lastBrace + 1);
      jsonResult = JSON.parse(jsonString);
    } catch (e) {
      console.error('⛔ Erreur parsing JSON IA:', e.message);
      return res.status(500).json({ error: 'Erreur parsing JSON IA', rawText });
    }

    return res.json(jsonResult);

  } catch (error) {
    console.error('❌ Erreur côté serveur :', error);
    return res.status(500).json({ error: 'Erreur lors de la génération Cohere' });
  }
});

app.listen(port, () => {
  console.log(`✅ Serveur actif sur le port ${port}`);
});

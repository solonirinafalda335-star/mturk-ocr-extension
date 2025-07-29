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

/**
 * Nettoyage complet de texte JSON brut généré par l'IA
 * - Corrige apostrophes dans les nombres (ex: 1'05 → 1.05)
 * - Supprime caractères non ASCII
 * - Supprime virgules en fin d'objet et en fin de tableau
 * - Ajoute des virgules manquantes entre objets JSON adjacents dans les tableaux
 * - Force les champs simples en string (pour éviter les erreurs JSON)
 * - Nettoie spécifiquement les champs "price" et "quantity"
 */
function sanitizeJSONText(rawText) {
  let text = rawText;

  // Nettoyage général
  text = text
    .replace(/(\d+)'(\d+)/g, '$1.$2')                // Ex: 1'05 → 1.05
    .replace(/[^\x00-\x7F]+/g, '')                   // Supprime caractères spéciaux
    .replace(/,\s*}/g, '}')                          // Supprime virgule avant }
    .replace(/,\s*]/g, ']')                          // Supprime virgule avant ]
    .replace(/}\s*{/g, '},{')                        // Ajoute virgule manquante entre objets adjacents
    .replace(/:\s*([^",{}\[\]\s]+)/g, ': "$1"');     // Force champs simples en string

  // Nettoyage spécifique "price"
  text = text.replace(/("price"\s*:\s*)"([^"]+)"/g, (match, p1, p2) => {
    let sanitized = p2.replace(/,/g, '.').replace(/[^\d\.\-]/g, '');
    if (isNaN(Number(sanitized)) || sanitized === '') sanitized = 'null';
    return `${p1}${sanitized === 'null' ? sanitized : `"${sanitized}"`}`;
  });

  // Nettoyage spécifique "quantity"
  text = text.replace(/("quantity"\s*:\s*)"([^"]+)"/g, (match, p1, p2) => {
    const digits = p2.match(/\d+/);
    return digits ? `${p1}${digits[0]}` : `${p1}null`;
  });

  return text;
}

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

    const firstBrace = rawText.indexOf('{');
    const lastBrace = rawText.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1) {
      return res.status(500).json({ error: 'Pas de JSON détecté dans la réponse', rawText });
    }

    const jsonString = rawText.substring(firstBrace, lastBrace + 1);
    const cleanedJsonString = sanitizeJSONText(jsonString);

    let jsonResult;
    try {
      jsonResult = JSON.parse(cleanedJsonString);
    } catch (e) {
      console.error('⛔ Erreur parsing JSON IA après nettoyage:', e.message);
      return res.status(500).json({ error: 'Erreur parsing JSON IA après nettoyage', rawText, cleanedJsonString });
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

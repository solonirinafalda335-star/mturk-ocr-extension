const express = require('express'); // ← importer express d'abord
const path = require('path');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const { CohereClient } = require('cohere-ai');

dotenv.config();

const app = express(); // ← initialiser app ici

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Exemple simple pour tester que ça fonctionne
app.get('/', (req, res) => {
  res.send('API MTurk OCR fonctionne ✅');
});

// Tu peux ajouter ici tes routes /api/admin/login etc...

mongoose.connect(process.env.MONGO_URL)
  .then(() => {
    console.log('✅ Connexion à MongoDB réussie');
    app.listen(PORT, () => {
      console.log(`✅ Serveur actif sur le port ${PORT}`);
    });
  })
  .catch(err => {
    console.error('❌ Erreur de connexion MongoDB :', err);
  });

const licenseSchema = new mongoose.Schema({
  code: { type: String, unique: true },
  durationDays: Number,
  createdAt: { type: Date, default: Date.now },
  usedAt: Date,
  deviceId: String,
});

licenseSchema.virtual('expiresAt').get(function () {
  return new Date(this.createdAt.getTime() + this.durationDays * 24 * 60 * 60 * 1000);
});

licenseSchema.virtual('status').get(function () {
  const now = new Date();
  if (this.usedAt && !this.deviceId) return 'used';
  if (this.deviceId && now > this.expiresAt) return 'expired';
  if (!this.usedAt && now < this.createdAt) return 'not yet active';
  if (this.deviceId) return 'used';
  return 'active';
});

const License = mongoose.model('License', licenseSchema);

// --- API Licences ---
app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body;

  if (username === "Mturk-OCR" && password === "Solonirina93") {
    res.json({ success: true, token: "admin-token" }); // ou mieux : un vrai JWT plus tard
  } else {
    res.status(401).json({ success: false, message: "Identifiants incorrects" });
  }
});

app.get('/api/admin/licenses', async (req, res) => {
  const licenses = await License.find({}).lean();
  const now = new Date();

  const enriched = licenses.map(l => ({
    ...l,
    expiresAt: new Date(l.createdAt.getTime() + l.durationDays * 86400000),
    status: l.deviceId
      ? (now > new Date(l.createdAt.getTime() + l.durationDays * 86400000) ? 'expired' : 'used')
      : 'active',
  }));

  return res.json(enriched);
});

// --- Cohere / AI Setup ---
const cohere = new CohereClient({
  token: process.env.COHERE_API_KEY,
});

function sanitizeJSONText(rawText) {
  let text = rawText;

  text = text.replace(/:\s*null(\d{1,2})(:?(\d{2}))?"?\s*(AM|PM)?/gi, (match, h, sep, m, suffix) => {
    if (h && m && suffix) return `: "${h}:${m} ${suffix.toUpperCase()}"`;
    return ': null';
  });

  text = text.replace(/:\s*null[^,\}\]\n"]*/g, ': null');

  text = text
    .replace(/(\d+)'(\d+)/g, '$1.$2')
    .replace(/[^\x00-\x7F]+/g, '')
    .replace(/,\s*}/g, '}')
    .replace(/,\s*]/g, ']')
    .replace(/}\s*{/g, '},{')
    .replace(/:\s*([a-zA-Z][^",{}\[\]\s]*)/g, ': "$1"');

  text = text.replace(/("price"\s*:\s*)"([^"]+)"/g, (match, p1, p2) => {
    let sanitized = p2.replace(/,/g, '.').replace(/[^\d\.\-]/g, '');
    if (isNaN(Number(sanitized)) || sanitized === '') sanitized = 'null';
    return `${p1}${sanitized === 'null' ? sanitized : `"${sanitized}"`}`;
  });

  text = text.replace(/("quantity"\s*:\s*)"([^"]+)"/g, (match, p1, p2) => {
    const digits = p2.match(/\d+/);
    return digits ? `${p1}${digits[0]}` : `${p1}null`;
  });

  text = text.replace(/("purchaseDate"\s*:\s*)"([^"]*)"/g, (match, p1, p2) => {
    const datePattern = /^\d{2}\/\d{2}\/\d{4}$/;
    return datePattern.test(p2) ? `${p1}"${p2}"` : `${p1}null`;
  });

  text = text.replace(/("purchaseTime"\s*:\s*)"([^"]*)"/g, (match, p1, p2) => {
    const timePattern = /^(0?[1-9]|1[0-2]):[0-5][0-9]\s?(AM|PM)$/i;
    return timePattern.test(p2) ? `${p1}"${p2}"` : `${p1}null`;
  });

  text = text.replace(/("totalPaid"\s*:\s*)"([^"]+)"/g, (match, p1, p2) => {
    let sanitized = p2.replace(/,/g, '.').replace(/[^\d\.\-]/g, '');
    if (isNaN(Number(sanitized)) || sanitized === '') sanitized = 'null';
    return `${p1}${sanitized === 'null' ? sanitized : `"${sanitized}"`}`;
  });

  return text;
}

// 🔍 Test de nettoyage
app.post('/api/test-cleanup', (req, res) => {
  const { rawJson } = req.body;

  if (!rawJson || typeof rawJson !== 'string') {
    return res.status(400).json({ error: 'Le champ "rawJson" est requis et doit être une chaîne' });
  }

  try {
    const cleaned = sanitizeJSONText(rawJson);
    const parsed = JSON.parse(cleaned);
    return res.json({ parsed, cleaned });
  } catch (e) {
    return res.status(500).json({
      error: 'Erreur parsing après nettoyage',
      message: e.message,
      cleanedAttempt: sanitizeJSONText(rawJson)
    });
  }
});

// 🔁 OCR Cohere
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
      console.error('Chaîne JSON nettoyée:', cleanedJsonString);
      return res.status(500).json({ error: 'Erreur parsing JSON IA après nettoyage', rawText, cleanedJsonString });
    }

    return res.json(jsonResult);

  } catch (error) {
    console.error('❌ Erreur côté serveur :', error);
    return res.status(500).json({ error: 'Erreur lors de la génération Cohere' });
  }
});

// 🚀 Démarrage serveur
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`✅ Serveur actif sur le port ${PORT}`);
});
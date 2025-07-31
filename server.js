const express = require('express');
const path = require('path');
const cors = require('cors');
const dotenv = require('dotenv');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const { PrismaClient } = require('@prisma/client');
const { CohereClient } = require('cohere-ai');

dotenv.config();
console.log("✅ DATABASE_URL =", process.env.DATABASE_URL);

const app = express();
const prisma = new PrismaClient();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`✅ Serveur actif sur le port ${PORT}`);
});

app.get('/', (req, res) => {
  res.send('API MTurk OCR fonctionne ✅');
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

function computeExpiresAt(createdAt, durationDays) {
  return new Date(createdAt.getTime() + durationDays * 86400000);
}

// --- API Activate License ---
app.post('/api/activate', async (req, res) => {
  const { code, deviceId } = req.body;

  if (!code || !deviceId) {
    return res.status(400).json({ success: false, message: 'Code et deviceId requis' });
  }

  const cleanedCode = code.trim().toUpperCase();

  try {
    const license = await prisma.license.findUnique({ where: { code: cleanedCode } });

    if (!license) {
      return res.status(400).json({ success: false, message: '🚫 Code invalide.' });
    }

    if (license.deviceId && license.deviceId !== deviceId) {
      return res.status(400).json({ success: false, message: '🚫 Code déjà utilisé sur un autre appareil' });
    }

    await prisma.license.update({
      where: { code: cleanedCode },
      data: {
        deviceId,
        usedAt: new Date(),
      }
    });

    const expiresAt = computeExpiresAt(license.createdAt, license.durationDays);

    return res.json({ success: true, message: '✅ Code activé avec succès', expiresAt });
  } catch (error) {
    console.error('❌ Erreur activation licence :', error);
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// --- API Admin Login ---
app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body;

  if (username === "Mturk-OCR" && password === "Solonirina93") {
    res.json({ success: true, token: "admin-token" });
  } else {
    res.status(401).json({ success: false, message: "Identifiants incorrects" });
  }
});

// --- API Admin Get Licenses ---
app.get('/api/admin/licenses', async (req, res) => {
  try {
    const licenses = await prisma.license.findMany();
    const now = new Date();

    const enriched = licenses.map(l => ({
      ...l,
      expiresAt: computeExpiresAt(new Date(l.createdAt), l.durationDays),
      status: l.deviceId
        ? (now > computeExpiresAt(new Date(l.createdAt), l.durationDays) ? 'expired' : 'used')
        : 'active',
    }));

    return res.json({ codes: enriched });
  } catch (error) {
    console.error('❌ Erreur récupération licences :', error);
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// --- API Admin Generate Licenses ---
app.post('/api/admin/generate', async (req, res) => {
  const { count, durationDays } = req.body;

  if (!count || !durationDays) {
    return res.status(400).json({ success: false, message: 'Champs requis manquants' });
  }

  const codes = [];

  for (let i = 0; i < count; i++) {
    const code = Math.random().toString(36).substring(2, 10).toUpperCase();

    const newLicense = await prisma.license.create({
      data: {
        code,
        durationDays,
      }
    });

    codes.push(newLicense);
  }

  res.json({ success: true, codes });
});

// --- Cohere Setup ---
const cohere = new CohereClient({
  token: process.env.COHERE_API_KEY,
});

// --- OCR JSON Cleanup ---
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

// --- API OCR Cleanup Test ---
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

// --- API OCR Enhance via Cohere ---
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

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

app.post('/api/activate', async (req, res) => {
  const { code, deviceId } = req.body;

  if (!code || !deviceId) {
    return res.status(400).json({ success: false, message: 'Code et deviceId requis' });
  }

  const cleanedCode = code.trim().toUpperCase();

  try {
    const license = await prisma.license.findUnique({ where: { code: cleanedCode } });

    if (!license) {
      return res.status(400).json({ success: false, message: '❌ Code invalide.' });
    }

    if (license.deviceId && license.deviceId !== deviceId) {
      return res.status(400).json({ success: false, message: '❌ Code déjà utilisé sur un autre appareil' });
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

app.post('/api/admin/login', async (req, res) => {
  const { username, password } = req.body;

  if (username === "Mturk-OCR" && password === "Solonirina93") {
    res.json({ success: true, token: "admin-token" });
  } else {
    res.status(401).json({ success: false, message: "Identifiants incorrects" });
  }
});

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

app.post('/api/admin/generate', async (req, res) => {
  const count = parseInt(req.body.count, 10);
  const durationDays = parseInt(req.body.durationDays, 10);

  if (isNaN(count) || isNaN(durationDays)) {
    return res.status(400).json({ success: false, message: 'count et durationDays doivent être des nombres' });
  }

  const codes = [];

  try {
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

  } catch (err) {
    console.error("❌ Erreur lors de la génération des licences :", err);
    res.status(500).json({ success: false, message: "Erreur serveur", error: err.message });
  }
});

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

app.get("/api/validate", async (req, res) => {
  const { code, device } = req.query;

  if (!code || !device) {
    return res.status(400).json({ status: "invalid", message: "Paramètres manquants" });
  }

  try {
    const license = await prisma.license.findUnique({
      where: { code: code.trim().toUpperCase() },
    });

    if (!license) {
      return res.json({ status: "invalid" });
    }

    if (license.usedAt && license.deviceId && license.deviceId !== device) {
      return res.json({ status: "invalid", message: "Déjà utilisé" });
    }

    // ✅ Calcule dynamique de la date d'expiration
    const expiresAt = computeExpiresAt(new Date(license.createdAt), license.durationDays);

    if (new Date() > expiresAt) {
      return res.json({ status: "expired" });
    }

    // Si jamais deviceId ou usedAt n'étaient pas encore définis, on les définit maintenant
    if (!license.usedAt || !license.deviceId) {
      await prisma.license.update({
        where: { code: code.trim().toUpperCase() },
        data: {
          usedAt: new Date(),
          deviceId: device,
        },
      });
    }

    return res.json({
      status: "valid",
      expires: expiresAt.toISOString().split("T")[0],
    });

  } catch (err) {
    console.error("❌ Erreur validate:", err);
    return res.status(500).json({ status: "error", message: "Erreur serveur" });
  }
});

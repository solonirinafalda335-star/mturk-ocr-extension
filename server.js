// server.js
const express = require('express');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.send('API MTurk OCR fonctionne ✅');
});

// Générer un code de test
app.post('/api/admin/generate', async (req, res) => {
  const { count, durationDays } = req.body;

  if (!count || !durationDays) {
    return res.status(400).json({ success: false, message: 'count et durationDays requis' });
  }

  const codes = [];

  for (let i = 0; i < count; i++) {
    const code = Math.random().toString(36).substring(2, 10).toUpperCase();

    const newLicense = await prisma.license.create({
      data: {
        code,
        durationDays: parseInt(durationDays, 10)
      }
    });

    codes.push(newLicense);
  }

  res.json({ success: true, codes });
});

// Activer un code
app.post('/api/activate', async (req, res) => {
  const { code, deviceId } = req.body;

  if (!code || !deviceId) {
    return res.status(400).json({ success: false, message: 'Code et deviceId requis' });
  }

  const cleanedCode = code.trim().toUpperCase();

  const license = await prisma.license.findUnique({ where: { code: cleanedCode } });

  if (!license) {
    return res.status(400).json({ success: false, message: 'Code invalide ou inexistant' });
  }

  if (license.deviceId && license.deviceId !== deviceId) {
    return res.status(400).json({ success: false, message: 'Code déjà utilisé sur un autre appareil' });
  }

  await prisma.license.update({
    where: { code: cleanedCode },
    data: {
      deviceId,
      usedAt: new Date(),
    }
  });

  res.json({ success: true, message: 'Code activé avec succès' });
});

app.listen(PORT, () => {
  console.log(`✅ Serveur actif sur http://localhost:${PORT}`);
});

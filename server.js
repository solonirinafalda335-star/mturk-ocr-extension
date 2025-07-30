const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const bcrypt = require('bcrypt');
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
 */
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

// 🔍 Endpoint test nettoyage
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

// 🔁 Endpoint principal OCR Cohere
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

// ✅ Vérification du mot de passe admin
app.post('/api/admin-login', async (req, res) => {
  const { password } = req.body;

  if (!password) {
    return res.status(400).json({ success: false, message: 'Mot de passe requis' });
  }

  try {
    const isValid = await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH);

    if (isValid) {
      return res.json({ success: true, message: 'Connexion réussie 🎉' });
    } else {
      return res.status(401).json({ success: false, message: 'Mot de passe incorrect ❌' });
    }
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
});

// 🧪 Interface HTML simple pour tester le login
app.get('/admin', (req, res) => {
  res.send(`
    <html>
      <head><title>Admin Login</title></head>
      <body style="font-family: sans-serif; padding: 2rem;">
        <h2>Connexion Admin</h2>
        <form onsubmit="login(event)">
          <input type="password" id="password" placeholder="Mot de passe" required />
          <button type="submit">Se connecter</button>
        </form>
        <pre id="result"></pre>
        <script>
          async function login(e) {
            e.preventDefault();
            const password = document.getElementById('password').value;
            const res = await fetch('/api/admin-login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ password }),
            });
            const data = await res.json();
            document.getElementById('result').innerText = JSON.stringify(data, null, 2);
          }
        </script>
      </body>
    </html>
  `);
});

app.listen(port, () => {
  console.log(`✅ Serveur actif sur le port ${port}`);
});

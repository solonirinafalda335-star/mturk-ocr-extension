import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { CohereClient } from 'cohere-ai';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ✅ Initialisation correcte du client Cohere
const cohere = new CohereClient({
  token: process.env.COHERE_API_KEY,
});

// ✅ Route d’amélioration OCR
app.post('/api/enhance-text', async (req, res) => {
  try {
    const { text } = req.body;

    const response = await cohere.generate({
      model: 'command',
      prompt: `Corrige et structure ce texte issu d’un reçu OCR pour l’analyse :\n\n${text}`,
      max_tokens: 500,
      temperature: 0.3,
    });

    const improvedText = response.generations[0].text;
    res.json({ improvedText });
  } catch (error) {
    console.error('Erreur côté serveur :', error);
    res.status(500).json({ error: 'Erreur lors de la génération Cohere' });
  }
});

app.listen(port, () => {
  console.log(`✅ Serveur actif sur le port ${port}`);
});

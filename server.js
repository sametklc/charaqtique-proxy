// server.js
const express = require('express');
const cors = require('cors');
const Replicate = require('replicate');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Replicate client
const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

// Karakter görselleri oluştur
app.post('/api/create-images', async (req, res) => {
  try {
    const { prompt, characterId } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    // Profil fotoğrafı için prompt (portrait)
    const profilePrompt = `${prompt}, portrait, headshot, close-up, professional photography, high quality`;
    
    // Boydan fotoğraf için prompt (full body)
    const fullBodyPrompt = `${prompt}, full body, standing, full length shot, professional photography, high quality`;

    // Replicate API ile görselleri oluştur
    const [profileOutput, fullBodyOutput] = await Promise.all([
      // Profil fotoğrafı
      replicate.run(
        "black-forest-labs/flux-1.1-pro",
        {
          input: {
            prompt: profilePrompt,
            aspect_ratio: "1:1",
            output_format: "png",
            output_quality: 90
          }
        }
      ),
      // Boydan fotoğraf
      replicate.run(
        "black-forest-labs/flux-1.1-pro",
        {
          input: {
            prompt: fullBodyPrompt,
            aspect_ratio: "9:16",
            output_format: "png",
            output_quality: 90
          }
        }
      )
    ]);

    // Replicate output genellikle array döner, ilk elemanı al
    const profileImageURL = Array.isArray(profileOutput) ? profileOutput[0] : profileOutput;
    const fullBodyImageURL = Array.isArray(fullBodyOutput) ? fullBodyOutput[0] : fullBodyOutput;

    res.json({
      profileImageURL,
      fullBodyImageURL,
      characterId
    });
  } catch (error) {
    console.error('Error creating images:', error);
    res.status(500).json({ error: 'Failed to create images', details: error.message });
  }
});

// Chat endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { characterId, message, characterPrompt } = req.body;

    if (!message || !characterPrompt) {
      return res.status(400).json({ error: 'Message and characterPrompt are required' });
    }

    // OpenAI GPT-4o-mini ile chat
    const systemPrompt = `${characterPrompt}\n\nRemember to stay in character and respond naturally based on the traits above.`;

    const output = await replicate.run(
      "openai/gpt-4o-mini",
      {
        input: {
          system_prompt: systemPrompt,
          prompt: message,
          max_tokens: 500,
          temperature: 0.7
        }
      }
    );

    // Replicate output'u işle
    let response = '';
    if (typeof output === 'string') {
      response = output;
    } else if (Array.isArray(output)) {
      response = output.join(' ');
    } else if (output && output.text) {
      response = output.text;
    } else {
      response = JSON.stringify(output);
    }

    res.json({
      response,
      characterId
    });
  } catch (error) {
    console.error('Error in chat:', error);
    res.status(500).json({ error: 'Failed to get chat response', details: error.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

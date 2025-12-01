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

    console.log('📥 Chat request received:', { characterId, message: message?.substring(0, 50) + '...' });

    if (!message || !characterPrompt) {
      console.error('❌ Missing required fields');
      return res.status(400).json({ error: 'Message and characterPrompt are required' });
    }

    // OpenAI GPT-4o-mini ile chat - Replicate'te bu model yok, meta/llama kullan
    const systemPrompt = `${characterPrompt}\n\nRemember to stay in character and respond naturally based on the traits above.`;

    console.log('🤖 Calling Replicate API...');
    
    // Replicate'te OpenAI modeli yok, meta/llama-3.1-8b-instruct kullan
    const output = await replicate.run(
      "meta/llama-3.1-8b-instruct",
      {
        input: {
          prompt: `${systemPrompt}\n\nUser: ${message}\n\nAssistant:`,
          max_tokens: 500,
          temperature: 0.7,
          top_p: 0.9
        }
      }
    );

    console.log('📤 Replicate output type:', typeof output);
    console.log('📤 Replicate output:', JSON.stringify(output).substring(0, 200));

    // Replicate output'u işle
    let response = '';
    if (typeof output === 'string') {
      response = output;
    } else if (Array.isArray(output)) {
      response = output.join(' ');
    } else if (output && typeof output === 'object') {
      // Stream response olabilir
      if (output.text) {
        response = output.text;
      } else if (output.response) {
        response = output.response;
      } else {
        // Tüm string değerleri birleştir
        const parts = [];
        for (const key in output) {
          if (typeof output[key] === 'string') {
            parts.push(output[key]);
          }
        }
        response = parts.join(' ') || JSON.stringify(output);
      }
    } else {
      response = String(output);
    }

    // Response'u temizle (eğer system prompt içeriyorsa)
    response = response.replace(/User:.*?Assistant:/s, '').trim();
    if (!response) {
      response = "I'm here, how can I help you?";
    }

    console.log('✅ Final response:', response.substring(0, 100) + '...');

    res.json({
      response,
      characterId
    });
  } catch (error) {
    console.error('❌ Error in chat:', error);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({ 
      error: 'Failed to get chat response', 
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

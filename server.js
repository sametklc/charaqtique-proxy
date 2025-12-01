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
    
    let response = '';
    
    try {
      // Daha basit bir model kullan - meta/llama-3-8b-instruct
      const fullPrompt = `${systemPrompt}\n\nUser: ${message}\n\nAssistant:`;
      
      console.log('📝 Full prompt length:', fullPrompt.length);
      
      const output = await replicate.run(
        "meta/llama-3-8b-instruct",
        {
          input: {
            prompt: fullPrompt,
            max_tokens: 500,
            temperature: 0.7,
            top_p: 0.9
          }
        }
      );

      console.log('📤 Replicate output type:', typeof output);
      console.log('📤 Replicate output is array:', Array.isArray(output));
      
      // Replicate output'u işle
      if (typeof output === 'string') {
        response = output;
      } else if (Array.isArray(output)) {
        // Array ise tüm string'leri birleştir
        response = output.filter(item => typeof item === 'string').join('').trim();
      } else if (output && typeof output === 'object') {
        // Object ise text veya response field'ını ara
        response = output.text || output.response || output.output || JSON.stringify(output);
      } else {
        response = String(output);
      }

      // Response'u temizle
      response = response
        .replace(/User:.*?Assistant:/s, '')
        .replace(/Assistant:/g, '')
        .trim();
        
      if (!response || response.length < 3) {
        response = "I'm here, how can I help you?";
      }
      
      console.log('✅ Response generated:', response.substring(0, 100) + '...');
      
    } catch (replicateError) {
      console.error('❌ Replicate API Error:', replicateError);
      console.error('❌ Error message:', replicateError.message);
      console.error('❌ Error stack:', replicateError.stack);
      
      // Daha detaylı hata mesajı
      if (replicateError.message) {
        console.error('❌ Full error:', JSON.stringify(replicateError, null, 2));
      }
      
      // Fallback: Basit bir response döndür
      response = `I understand you said "${message.substring(0, 50)}...". Let me respond naturally based on my character.`;
      
      // Hata fırlatma, sadece logla ve fallback response kullan
      console.log('⚠️ Using fallback response due to error');
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

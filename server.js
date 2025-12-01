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

// Replicate API timeout ayarı
const REPLICATE_TIMEOUT = 60000; // 60 saniye

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
    const { characterId, message, characterPrompt, characterName } = req.body;

    console.log('📥 Chat request received:', { characterId, characterName, message: message?.substring(0, 50) + '...' });

    if (!message || !characterPrompt) {
      console.error('❌ Missing required fields');
      return res.status(400).json({ error: 'Message and characterPrompt are required' });
    }

    // System prompt'a karakter ismini ekle
    const systemPrompt = characterName 
      ? `${characterPrompt}\n\nRemember: Your name is ${characterName}. Always use this name when referring to yourself.`
      : `${characterPrompt}\n\nRemember to stay in character and respond naturally based on the traits above.`;

    console.log('🤖 Calling Replicate API...');
    
    let response = '';
    
    try {
      // Meta Llama 3 için doğru prompt formatı
      const fullPrompt = `<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n\n${systemPrompt}<|eot_id|><|start_header_id|>user<|end_header_id|>\n\n${message}<|eot_id|><|start_header_id|>assistant<|end_header_id|>\n\n`;
      
      console.log('📝 Full prompt length:', fullPrompt.length);
      console.log('📝 System prompt:', systemPrompt.substring(0, 100) + '...');
      console.log('📝 User message:', message);
      
      console.log('🤖 Calling Replicate with model: meta/meta-llama-3-8b-instruct');
      
      // Timeout ile Replicate API çağrısı
      const replicatePromise = replicate.run(
        "meta/meta-llama-3-8b-instruct",
        {
          input: {
            prompt: fullPrompt,
            max_tokens: 500,
            temperature: 0.7,
            top_p: 0.9
          }
        }
      );
      
      // Timeout wrapper
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Replicate API timeout')), REPLICATE_TIMEOUT);
      });
      
      const output = await Promise.race([replicatePromise, timeoutPromise]);

      console.log('📤 Replicate output type:', typeof output);
      console.log('📤 Replicate output is array:', Array.isArray(output));
      
      // Replicate output stream olabilir, tüm parçaları birleştir
      if (Array.isArray(output)) {
        // Array ise tüm string'leri birleştir
        response = output
          .filter(item => item != null)
          .map(item => typeof item === 'string' ? item : String(item))
          .join('')
          .trim();
      } else if (typeof output === 'string') {
        response = output;
      } else if (output && typeof output === 'object') {
        // Object ise text veya response field'ını ara
        response = output.text || output.response || output.output || output.content || JSON.stringify(output);
      } else {
        response = String(output);
      }

      console.log('📥 Raw response:', response.substring(0, 200));

      // Response'u temizle - Llama format token'larını kaldır
      response = response
        .replace(/<\|begin_of_text\|>/g, '')
        .replace(/<\|start_header_id\|>/g, '')
        .replace(/<\|end_header_id\|>/g, '')
        .replace(/<\|eot_id\|>/g, '')
        .replace(/<\|end_of_text\|>/g, '')
        .replace(/system.*?assistant:/s, '')
        .replace(/User:.*?Assistant:/s, '')
        .replace(/Assistant:/g, '')
        .trim();
        
      if (!response || response.length < 3) {
        console.warn('⚠️ Response too short, using default');
        response = "I'm here, how can I help you?";
      }
      
      console.log('✅ Final response:', response.substring(0, 100) + '...');
      
    } catch (replicateError) {
      console.error('❌ Replicate API Error:', replicateError);
      console.error('❌ Error message:', replicateError.message);
      console.error('❌ Error name:', replicateError.name);
      console.error('❌ Error stack:', replicateError.stack);
      
      // Daha detaylı hata mesajı
      if (replicateError.response) {
        console.error('❌ Error response:', replicateError.response.data);
        console.error('❌ Error status:', replicateError.response.status);
      }
      
      // Hata fırlat ki üst seviye catch bloğu yakalasın
      throw new Error(`Replicate API error: ${replicateError.message || 'Unknown error'}`);
    }

    console.log('✅ Final response:', response.substring(0, 100) + '...');

    if (!response || response.length < 3) {
      console.warn('⚠️ Empty response, using character-based fallback');
      // Karakter özelliklerine göre daha iyi bir fallback
      response = `*${characterPrompt.includes('Romantic') ? 'smiles warmly* ' : ''}${message}. That's interesting. Tell me more about that.`;
    }

    res.json({
      response,
      characterId
    });
  } catch (error) {
    console.error('❌ Error in chat:', error);
    console.error('❌ Error message:', error.message);
    console.error('❌ Error stack:', error.stack);
    
    // Hata durumunda bile kullanıcıya anlamlı bir mesaj döndür
    const errorResponse = `I'm having trouble processing that right now, but I heard you say "${message.substring(0, 30)}...". Can you try rephrasing that?`;
    
    res.status(500).json({ 
      response: errorResponse,
      error: 'Failed to get chat response', 
      details: error.message,
      characterId
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

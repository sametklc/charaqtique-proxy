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
    const { characterId, message, characterPrompt, characterName, messageHistory } = req.body;

    console.log('📥 Chat request received:', { characterId, characterName, message: message?.substring(0, 50) + '...', historyLength: messageHistory?.length || 0 });

    if (!message || !characterPrompt) {
      console.error('❌ Missing required fields');
      return res.status(400).json({ error: 'Message and characterPrompt are required' });
    }

    // System prompt'u direkt kullan - zaten içinde tüm bilgiler var
    const systemPrompt = characterPrompt;

    console.log('🤖 Calling Replicate API with openai/gpt-4o-mini...');
    console.log('📝 System prompt:', systemPrompt.substring(0, 100) + '...');
    console.log('📝 User message:', message);
    console.log('📝 Message history length:', messageHistory?.length || 0);
    
    let response = '';
    
    try {
      // Mesaj geçmişini hazırla
      const messages = [];
      
      // System message ekle
      messages.push({
        role: 'system',
        content: systemPrompt
      });
      
      // Mesaj geçmişini ekle (eğer varsa)
      if (messageHistory && Array.isArray(messageHistory)) {
        messageHistory.forEach(msg => {
          if (msg.role && msg.content) {
            messages.push({
              role: msg.role,
              content: msg.content
            });
          }
        });
      }
      
      // Son kullanıcı mesajını ekle
      messages.push({
        role: 'user',
        content: message
      });
      
      console.log('📤 Total messages to send:', messages.length);
      
      // Replicate üzerinden OpenAI GPT-4o-mini kullan
      const output = await replicate.run(
        "openai/gpt-4o-mini",
        {
          input: {
            messages: messages,
            max_tokens: 500,
            temperature: 0.7
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
        response = output
          .filter(item => item != null)
          .map(item => typeof item === 'string' ? item : String(item))
          .join('')
          .trim();
      } else if (output && typeof output === 'object') {
        // Object ise text veya response field'ını ara
        response = output.text || output.response || output.output || output.content || JSON.stringify(output);
      } else {
        response = String(output);
      }

      console.log('📥 Raw response:', response.substring(0, 200));
      
      // Response'u temizle
      response = response.trim();
      
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

// Karakter fotoğrafı üret (kullanıcı isteğine göre)
app.post('/api/generate-photo', async (req, res) => {
  try {
    const { characterId, description, characterName, characterTraits, profileImageBase64 } = req.body;

    console.log('📸 Photo generation request received');
    console.log('📸 Character:', characterName);
    console.log('📸 Description:', description);
    console.log('📸 Character traits:', JSON.stringify(characterTraits));

    if (!description) {
      return res.status(400).json({ error: 'Description is required' });
    }

    // Karakterin fiziksel özelliklerini description'a çevir
    const getPhysicalAppearanceDescription = (physical) => {
      switch (physical) {
        case "A": return "Female, 20-25 years old, blonde hair";
        case "B": return "Male, 25-30 years old, dark brown or black hair";
        case "C": return "Female, 18-22 years old, colorful or unusual hair (pink, blue, purple)";
        case "D": return "Male, 30-35 years old, brown hair";
        case "E": return "Non-binary or any gender, 22-28 years old, red or auburn hair";
        default: return "Average appearance";
      }
    };

    const getEyeColorDescription = (eye) => {
      switch (eye) {
        case "A": return "Bright blue eyes with soft, kind facial features";
        case "B": return "Deep brown eyes with sharp, defined facial features";
        case "C": return "Green or hazel eyes with distinctive, memorable features";
        case "D": return "Dark, intense eyes with mysterious, captivating features";
        case "E": return "Expressive eyes with animated, lively facial features";
        default: return "Average eyes and features";
      }
    };

    const getBodyTypeDescription = (body) => {
      switch (body) {
        case "A": return "Slim build, average height (5'6\" to 5'10\"), graceful and elegant";
        case "B": return "Athletic build, tall (5'10\" to 6'2\"), strong and confident";
        case "C": return "Curvy build, petite to average height (5'2\" to 5'7\"), warm and inviting";
        case "D": return "Muscular build, tall (6'0\" to 6'4\"), powerful and imposing";
        case "E": return "Average build, any height, balanced and approachable";
        default: return "Average build";
      }
    };

    const getAppearanceDescription = (appearance) => {
      switch (appearance) {
        case "A": return "Modern and Chic (Casual) - Today's fashion, sweatshirt, jeans, or elegant dress";
        case "B": return "Cyberpunk / Futuristic - Neon colors, technological accessories, from the future";
        case "C": return "Gothic / Dark - Black-heavy, tattoos, piercings, melancholic vibe";
        case "D": return "Anime / Cosplay - Colorful hair, big eyes, fantasy costumes";
        case "E": return "Old Money / Classic - Suit, elegant jewelry, rich and elite appearance";
        default: return "Modern";
      }
    };

    // Karakterin fiziksel özelliklerini description'a çevir
    const physicalDesc = getPhysicalAppearanceDescription(characterTraits?.physicalAppearance || '');
    const eyeDesc = getEyeColorDescription(characterTraits?.eyeColorAndFeatures || '');
    const bodyDesc = getBodyTypeDescription(characterTraits?.bodyTypeAndHeight || '');
    const appearanceDesc = getAppearanceDescription(characterTraits?.appearance || '');

    // Karakterin görünümünü koruyarak istenen fotoğrafı üret
    // Önce karakterin temel görünümü, sonra kullanıcının isteği
    const photoPrompt = `${characterName}, ${physicalDesc}, ${eyeDesc}, ${bodyDesc}, ${appearanceDesc.toLowerCase()} fashion style, ${description}, professional photography, high quality, detailed, photorealistic`;

    console.log('📸 Photo prompt:', photoPrompt);
    console.log('📸 Has profile image for face consistency:', !!profileImageBase64);

    // Flux input parametreleri
    const fluxInput = {
      prompt: photoPrompt,
      aspect_ratio: "3:4", // Portrait format (profil fotoğrafı gibi)
      output_format: "png",
      output_quality: 90
    };

    // Eğer profil fotoğrafı varsa, yüz tutarlılığı için kullan
    // Not: Flux-1.1-pro'da img2img için farklı parametreler gerekebilir
    // Alternatif: IP-Adapter veya face consistency için özel modeller
    if (profileImageBase64) {
      try {
        // Base64'ü buffer'a çevir ve Replicate'e gönder
        // Flux-1.1-pro'da image parametresi img2img için kullanılabilir
        const imageBuffer = Buffer.from(profileImageBase64, 'base64');
        
        // Replicate'e base64 string olarak gönder (bazı modeller data URL formatını kabul eder)
        // Veya doğrudan buffer gönderebiliriz
        fluxInput.image = `data:image/jpeg;base64,${profileImageBase64}`;
        
        // Strength parametresi varsa ekle (img2img için)
        // Not: Flux-1.1-pro'nun API'sine göre bu parametre farklı olabilir
        fluxInput.strength = 0.4; // Yüzü korurken yeni poz/arka plana izin verir
        
        console.log('📸 Using profile image for face consistency (strength: 0.4)');
        console.log('📸 Image size:', imageBuffer.length, 'bytes');
      } catch (error) {
        console.error('❌ Error processing profile image:', error);
        // Hata olsa bile devam et, sadece profil fotoğrafı olmadan üret
      }
    }

    // Replicate API ile fotoğraf oluştur
    const output = await Promise.race([
      replicate.run(
        "black-forest-labs/flux-1.1-pro",
        {
          input: fluxInput
        }
      ),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Photo generation timeout')), REPLICATE_TIMEOUT * 2) // Fotoğraf üretimi daha uzun sürebilir
      )
    ]);

    // Replicate output formatı: ["https://..."]
    let imageURL;
    if (Array.isArray(output)) {
      imageURL = output[0];
    } else if (typeof output === 'string') {
      imageURL = output;
    } else if (output && typeof output === 'object') {
      // Bazen output bir obje olabilir
      imageURL = output.url || output[0] || null;
    } else {
      imageURL = null;
    }

    if (!imageURL) {
      console.error('❌ No image URL in output');
      console.error('❌ Output type:', typeof output);
      console.error('❌ Output value:', JSON.stringify(output));
      return res.status(500).json({ error: 'Failed to generate photo - no image URL in response' });
    }

    console.log('✅ Photo generated:', imageURL);

    res.json({ 
      imageURL: imageURL,
      characterId: characterId
    });

  } catch (error) {
    console.error('❌ Error in photo generation:', error);
    console.error('❌ Error message:', error.message);
    console.error('❌ Error stack:', error.stack);
    
    res.status(500).json({ 
      error: 'Failed to generate photo', 
      details: error.message
    });
  }
});

// OpenAI Realtime API WebSocket bağlantısı
app.post('/api/realtime/connect', async (req, res) => {
  try {
    const { characterName, characterPrompt } = req.body;

    console.log('📞 Realtime connection request received');
    console.log('📞 Character name:', characterName);
    console.log('📞 Character prompt length:', characterPrompt?.length || 0);

    if (!characterPrompt) {
      console.error('❌ Character prompt is missing');
      return res.status(400).json({ error: 'Character prompt is required' });
    }

    // OpenAI Realtime API'ye bağlan
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    
    if (!OPENAI_API_KEY) {
      console.error('❌ OpenAI API key not configured');
      return res.status(500).json({ error: 'OpenAI API key not configured' });
    }

    console.log('✅ OpenAI API key found (length:', OPENAI_API_KEY.length, ')');

    // OpenAI Realtime API WebSocket URL'i - Realtime Mini kullan (daha ucuz)
    const wsUrl = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-mini';

    console.log('🔌 WebSocket URL:', wsUrl);

    // Optimized instructions for better language detection and response quality
    const enhancedInstructions = `${characterPrompt}

You are ${characterName || 'the character'}. 

CRITICAL RULES:
1. ALWAYS respond in the EXACT SAME LANGUAGE the user speaks. Detect their language automatically.
2. Keep answers SHORT - maximum 1-2 sentences. Be concise.
3. Wait for the user to COMPLETELY finish speaking before you respond.
4. If the user starts speaking while you're talking, STOP IMMEDIATELY.
5. Listen carefully to what the user says and respond naturally based on your character traits.
6. Don't repeat your name or traits unless specifically asked.`;

    // iOS uygulamasına WebSocket URL'i ve auth bilgisini döndür
    const response = {
      websocket_url: wsUrl,
      auth_token: OPENAI_API_KEY,
      instructions: enhancedInstructions
    };

    console.log('✅ Sending response to client');
    res.json(response);

  } catch (error) {
    console.error('❌ Error in realtime connect:', error);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({ error: 'Failed to create realtime connection', details: error.message });
  }
});


// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

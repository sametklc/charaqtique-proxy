// server.js
const express = require('express');
const cors = require('cors');
const Replicate = require('replicate');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Fotoğraf base64 için daha büyük limit
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Replicate client
const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

// Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ SUPABASE_URL and SUPABASE_ANON_KEY must be set in environment variables');
  console.error('📝 SUPABASE_URL format: https://xxxxx.supabase.co');
  console.error('📝 SUPABASE_ANON_KEY: anon public key from Supabase Dashboard > Settings > API');
}

const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

// Supabase bağlantısını test et
if (supabase) {
  console.log('✅ Supabase client initialized');
  console.log(`📡 Supabase URL: ${supabaseUrl}`);
} else {
  console.warn('⚠️ Supabase not configured - data will not persist');
}

// Replicate API timeout ayarı
const REPLICATE_TIMEOUT = 60000; // 60 saniye

// ========== SUPABASE STORAGE HELPER FUNCTIONS ==========

/**
 * Generic helper to upload buffer to Supabase Storage
 * @param {Buffer} buffer - Image buffer
 * @param {string} contentType - MIME type (e.g., 'image/jpeg', 'image/png')
 * @param {string} filename - Path in bucket (e.g., "avatars/character_id_profile.jpg")
 * @returns {Promise<string|null>} - Public URL or null on error
 */
async function uploadToSupabase(buffer, contentType, filename) {
  if (!supabase) {
    console.error('❌ Supabase not configured');
    return null;
  }

  try {
    // Upload to Supabase Storage
    const { data, error } = await supabase.storage
      .from('images')
      .upload(filename, buffer, {
        contentType: contentType,
        upsert: true // Overwrite if exists
      });

    if (error) {
      console.error('❌ Supabase Storage upload error:', error);
      return null;
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('images')
      .getPublicUrl(filename);

    console.log(`✅ Uploaded image to Supabase Storage: ${filename}`);
    console.log(`📸 Public URL: ${urlData.publicUrl}`);
    
    return urlData.publicUrl;
  } catch (error) {
    console.error('❌ Error uploading to Supabase Storage:', error);
    return null;
  }
}

/**
 * Upload Base64 image to Supabase Storage
 * @param {string} base64Data - Base64 string (with or without data URI prefix)
 * @param {string} filePath - Path in bucket (e.g., "avatars/character_id_profile.jpg")
 * @returns {Promise<string|null>} - Public URL or null on error
 */
async function uploadBase64ToSupabase(base64Data, filePath) {
  try {
    // Remove data URI prefix if present
    let base64String = base64Data;
    if (base64String.includes(',')) {
      base64String = base64String.split(',')[1];
    }

    // Convert base64 to Buffer
    const buffer = Buffer.from(base64String, 'base64');

    // Use generic upload function
    return await uploadToSupabase(buffer, 'image/jpeg', filePath);
  } catch (error) {
    console.error('❌ Error processing base64 image:', error);
    return null;
  }
}

/**
 * Download image from URL and upload to Supabase Storage
 * @param {string} imageUrl - URL of the image to download
 * @param {string} filename - Path in bucket (e.g., "generated/uuid.jpg")
 * @returns {Promise<string|null>} - Public URL or null on error
 */
async function uploadUrlToSupabase(imageUrl, filename) {
  if (!supabase) {
    console.error('❌ Supabase not configured');
    return null;
  }

  try {
    // Download image from URL using https/http
    const https = require('https');
    const http = require('http');
    
    const parsedUrl = new URL(imageUrl);
    const client = parsedUrl.protocol === 'https:' ? https : http;

    const buffer = await new Promise((resolve, reject) => {
      const request = client.get(imageUrl, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download image: ${response.statusCode}`));
          return;
        }

        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve(Buffer.concat(chunks)));
        response.on('error', reject);
      });

      request.on('error', reject);
      request.setTimeout(30000, () => {
        request.destroy();
        reject(new Error('Download timeout'));
      });
    });

    // Detect content type from response headers or filename
    let contentType = 'image/jpeg'; // Default
    if (filename.endsWith('.png')) {
      contentType = 'image/png';
    } else if (filename.endsWith('.jpg') || filename.endsWith('.jpeg')) {
      contentType = 'image/jpeg';
    }

    // Use generic upload function
    return await uploadToSupabase(buffer, contentType, filename);
  } catch (error) {
    console.error('❌ Error uploading URL to Supabase Storage:', error);
    return null;
  }
}

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

    console.log('📸 ========== Photo generation request received ==========');
    console.log('📸 Character:', characterName);
    console.log('📸 Description:', description);
    console.log('📸 Character ID:', characterId);
    console.log('📸 Has profile image:', !!profileImageBase64);
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
    
    // Portre isteği kontrolü
    const descriptionLower = description.toLowerCase();
    const isPortraitRequest = descriptionLower.includes('portrait') || 
                              descriptionLower.includes('headshot') || 
                              descriptionLower.includes('close-up') ||
                              descriptionLower.includes('closeup') ||
                              descriptionLower.includes('face only');
    
    console.log('📸 Has profile image for face consistency:', !!profileImageBase64);
    console.log('📸 Is portrait request:', isPortraitRequest);
    
    // ========== PROMPT CONSTRUCTION - STRICTLY SEPARATED ==========
    
    // SCENARIO A: Portrait/Close-up Prompt (Detailed - includes facial features)
    // This prompt includes ALL details (physicalDesc, eyeDesc, bodyDesc) to guide the style
    const photoPrompt = `${description}, ${characterName} (${physicalDesc}, ${eyeDesc}, ${bodyDesc}), ${appearanceDesc.toLowerCase()} fashion style, high quality, detailed, photorealistic`;
    
    // SCENARIO B: Action/Full-body Scene Prompt (Minimal - NO facial details)
    // CRITICAL: Exclude eyeDesc and detailed physicalDesc to prevent portrait bias
    // Only include: user description + body type + appearance + wide angle directives
    const scenePrompt = `${description}, ${characterName} (${bodyDesc}), ${appearanceDesc.toLowerCase()} fashion style, wide angle shot, full body visible, complete scene, environmental context, high quality, detailed, photorealistic`;
    
    console.log('📸 Photo prompt (Scenario A - Portrait):', photoPrompt);
    console.log('📸 Scene prompt (Scenario B - Action):', scenePrompt);

    let imageURL;

    // ========== SCENARIO A: Portrait/Close-up Request ==========
    if (isPortraitRequest && profileImageBase64) {
      console.log('📸 SCENARIO A: Portrait request - using Img2Img with Flux 1.1 Pro');
      
      // Flux 1.1 Pro input parametreleri (Img2Img)
      const fluxInput = {
        prompt: photoPrompt,
        aspect_ratio: "16:9",
        output_format: "jpg"
      };

      try {
        // Base64 string'in uzunluğunu kontrol et
        const base64Length = profileImageBase64.length;
        console.log('📸 Base64 image length:', base64Length, 'characters');
        
        // Eğer çok büyükse (5MB'den fazla), kullanma
        if (base64Length > 5 * 1024 * 1024) {
          console.warn('⚠️ Base64 image too large, skipping img2img');
        } else {
          // Base64'ü data URL formatına çevir
          const imageDataUrl = `data:image/jpeg;base64,${profileImageBase64}`;
          
          // Flux 1.1 Pro için img2img parametreleri
          fluxInput.image = imageDataUrl;
          fluxInput.strength = 0.3; // Portrait için daha yüksek strength
          
          console.log('📸 Using profile image for face consistency (img2img with Flux 1.1 Pro)');
          console.log('📸 Image size:', Buffer.from(profileImageBase64, 'base64').length, 'bytes');
          console.log('📸 Strength:', fluxInput.strength);
        }
      } catch (error) {
        console.error('❌ Error processing profile image:', error);
        return res.status(500).json({ 
          error: 'Failed to process profile image',
          details: error.message
        });
      }

      // Replicate API ile fotoğraf oluştur (Flux 1.1 Pro - img2img)
      try {
        const output = await Promise.race([
          replicate.run("black-forest-labs/flux-1.1-pro", { input: fluxInput }),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Photo generation timeout')), REPLICATE_TIMEOUT * 3)
          )
        ]);
        
        // Extract image URL from output
        if (Array.isArray(output)) {
          imageURL = output[0];
        } else if (typeof output === 'string') {
          imageURL = output;
        } else if (output && typeof output === 'object') {
          imageURL = output.url || output.image || output[0] || null;
        }
        
        console.log('✅ Portrait photo generated:', imageURL);
      } catch (error) {
        console.error('❌ Replicate API error (portrait):', error);
        return res.status(500).json({ 
          error: 'Failed to generate photo',
          details: error.message || 'Unknown error',
          model: 'black-forest-labs/flux-1.1-pro'
        });
      }
    }
    // ========== SCENARIO B: Action/Full-body Request ==========
    else {
      console.log('📸 SCENARIO B: Action/Full-body request - using Text-to-Image + Face Swap');
      
      // Step 1: Generate scene with Flux 1.1 Pro (Text-to-Image, NO image input)
      // CRITICAL: Use scenePrompt (NOT photoPrompt) to avoid portrait bias
      const fluxInput = {
        prompt: scenePrompt, // Use scenePrompt which excludes facial details
        aspect_ratio: "16:9",
        output_format: "jpg"
      };
      
      console.log('📸 Step 1: Generating scene with Flux 1.1 Pro (text-to-image)...');
      console.log('📸 Using scenePrompt (no facial details to prevent zoom-in):', scenePrompt);
      
      let sceneImageURL;
      try {
        const output = await Promise.race([
          replicate.run("black-forest-labs/flux-1.1-pro", { input: fluxInput }),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Scene generation timeout')), REPLICATE_TIMEOUT * 3)
          )
        ]);
        
        // Extract scene image URL from output
        if (Array.isArray(output)) {
          sceneImageURL = output[0];
        } else if (typeof output === 'string') {
          sceneImageURL = output;
        } else if (output && typeof output === 'object') {
          sceneImageURL = output.url || output.image || output[0] || null;
        }
        
        console.log('✅ Scene generated:', sceneImageURL);
      } catch (error) {
        console.error('❌ Replicate API error (scene generation):', error);
        return res.status(500).json({ 
          error: 'Failed to generate scene',
          details: error.message || 'Unknown error',
          model: 'black-forest-labs/flux-1.1-pro'
        });
      }
      
      // Step 2: Face Swap using yan-ops/face_swap
      if (profileImageBase64 && sceneImageURL) {
        console.log('📸 Step 2: Performing face swap with yan-ops/face_swap...');
        
        try {
          // Convert base64 to data URL for face swap
          const sourceImageDataUrl = `data:image/jpeg;base64,${profileImageBase64}`;
          
          const faceSwapInput = {
            target_image: sceneImageURL, // The generated scene
            source_image: sourceImageDataUrl // The character's profile image
          };
          
          console.log('📸 Face swap input:', {
            target_image: sceneImageURL,
            source_image: '[base64 data]'
          });
          
          const faceSwapOutput = await Promise.race([
            replicate.run("yan-ops/face_swap", { input: faceSwapInput }),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Face swap timeout')), REPLICATE_TIMEOUT * 3)
            )
          ]);
          
          // Extract final image URL from face swap output
          if (Array.isArray(faceSwapOutput)) {
            imageURL = faceSwapOutput[0];
          } else if (typeof faceSwapOutput === 'string') {
            imageURL = faceSwapOutput;
          } else if (faceSwapOutput && typeof faceSwapOutput === 'object') {
            imageURL = faceSwapOutput.url || faceSwapOutput.image || faceSwapOutput[0] || null;
          }
          
          console.log('✅ Face swap completed:', imageURL);
        } catch (error) {
          console.error('❌ Face swap error:', error);
          // Fallback to scene image if face swap fails
          console.warn('⚠️ Face swap failed, using scene image as fallback');
          imageURL = sceneImageURL;
        }
      } else {
        // No profile image, use scene directly
        console.log('⚠️ No profile image available, using scene image directly');
        imageURL = sceneImageURL;
      }
    }

    // Validate image URL
    if (!imageURL) {
      console.error('❌ No image URL in output');
      return res.status(500).json({ 
        error: 'Failed to generate photo - no image URL in response'
      });
    }
    
    // URL'in geçerli olup olmadığını kontrol et
    if (!imageURL.startsWith('http://') && !imageURL.startsWith('https://')) {
      console.error('❌ Invalid image URL format:', imageURL);
      return res.status(500).json({ 
        error: 'Failed to generate photo - invalid image URL format',
        imageURL: imageURL
      });
    }

    console.log('✅ Final photo generated from Replicate:', imageURL);

    // CRITICAL: Download Replicate image and upload to Supabase Storage for persistence
    console.log('📥 Downloading image from Replicate and uploading to Supabase Storage...');
    const uuid = require('crypto').randomUUID();
    const filePath = `generated/${uuid}.jpg`;
    const supabasePublicUrl = await uploadUrlToSupabase(imageURL, filePath);

    if (!supabasePublicUrl) {
      console.error('❌ Failed to upload to Supabase Storage, returning Replicate URL as fallback');
      // Fallback to Replicate URL if Storage upload fails
      res.json({ 
        imageURL: imageURL,
        characterId: characterId
      });
      return;
    }

    console.log('✅ Photo uploaded to Supabase Storage, returning Public URL:', supabasePublicUrl);

    // Return Supabase Public URL (permanent) instead of Replicate URL (temporary)
    res.json({ 
      imageURL: supabasePublicUrl,
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

CRITICAL RULES FOR VOICE CONVERSATION:
1. ALWAYS respond in the EXACT SAME LANGUAGE the user speaks. Detect their language automatically.
2. Keep answers SHORT - maximum 1-2 sentences. Be concise.
3. Wait for the user to COMPLETELY finish speaking before you respond.
4. If the user starts speaking while you're talking, STOP IMMEDIATELY.
5. Listen carefully to what the user says and respond naturally based on your character traits.
6. Don't repeat your name or traits unless specifically asked.
7. NEVER use formal or corporate language. Be casual, warm, and genuine.
8. DON'T constantly ask questions. Make statements, share thoughts, or react naturally.
9. Talk like a real person, not like a customer service representative or AI assistant.
10. Be authentic and conversational - avoid phrases like "How can I help you?" or "What would you like to talk about?".`;

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


// Karakterleri kaydet (Supabase)
app.post('/api/save-characters', async (req, res) => {
  try {
    const { userId, characters } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    if (!characters) {
      return res.status(400).json({ error: 'characters is required' });
    }

    if (!supabase) {
      return res.status(500).json({ error: 'Supabase not configured' });
    }

    // Önce mevcut karakterleri al (Supabase Storage URL'lerini korumak için)
    const { data: existingCharacters, error: fetchError } = await supabase
      .from('characters')
      .select('character_id, profile_image_url, full_body_image_url')
      .eq('user_id', userId);

    // Mevcut karakterlerin Supabase Storage URL'lerini sakla
    const existingImageURLs = {};
    if (existingCharacters) {
      for (const existing of existingCharacters) {
        existingImageURLs[existing.character_id] = {
          profile_image_url: existing.profile_image_url,
          full_body_image_url: existing.full_body_image_url
        };
      }
    }

    // Önce mevcut karakterleri sil (upsert için)
    await supabase
      .from('characters')
      .delete()
      .eq('user_id', userId);

    // Yeni karakterleri ekle
    const charactersToInsert = characters.map(char => {
      // characterTraits'i JSONB formatına çevir
      let traits = char.characterTraits;
      if (typeof traits !== 'object') {
        traits = {};
      }
      
      // Eğer profileImageURL veya fullBodyImageURL boşsa veya local path ise (file:// ile başlıyorsa),
      // mevcut Supabase Storage URL'sini kullan
      let profileImageURL = char.profileImageURL || null;
      let fullBodyImageURL = char.fullBodyImageURL || null;
      
      if (!profileImageURL || profileImageURL.startsWith('file://') || profileImageURL === '') {
        const existing = existingImageURLs[char.id];
        if (existing && existing.profile_image_url) {
          profileImageURL = existing.profile_image_url;
          console.log(`📸 Using existing profile URL for character ${char.id}: ${profileImageURL}`);
        }
      }
      
      if (!fullBodyImageURL || fullBodyImageURL.startsWith('file://') || fullBodyImageURL === '') {
        const existing = existingImageURLs[char.id];
        if (existing && existing.full_body_image_url) {
          fullBodyImageURL = existing.full_body_image_url;
          console.log(`📸 Using existing full body URL for character ${char.id}: ${fullBodyImageURL}`);
        }
      }
      
      return {
        user_id: userId,
        character_id: char.id,
        name: char.name,
        profile_image_url: profileImageURL,
        full_body_image_url: fullBodyImageURL,
        created_at: char.createdAt,
        is_user_created: char.isUserCreated || true,
        character_traits: traits
      };
    });

    const { data, error } = await supabase
      .from('characters')
      .insert(charactersToInsert);

    if (error) {
      console.error('❌ Supabase error saving characters:', error);
      return res.status(500).json({ error: 'Failed to save characters', details: error.message });
    }

    console.log(`✅ Saved ${characters.length} characters for user ${userId}`);
    res.json({ success: true, count: characters.length });
  } catch (error) {
    console.error('❌ Error saving characters:', error);
    res.status(500).json({ error: 'Failed to save characters', details: error.message });
  }
});

// Karakterleri yükle (Supabase)
app.get('/api/load-characters', async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    if (!supabase) {
      return res.status(500).json({ error: 'Supabase not configured' });
    }

    const { data, error } = await supabase
      .from('characters')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('❌ Supabase error loading characters:', error);
      return res.status(500).json({ error: 'Failed to load characters', details: error.message });
    }

    // Supabase'den gelen verileri iOS formatına çevir
    const characters = (data || []).map(row => {
      // character_traits JSONB'den parse et
      let traits = row.character_traits;
      if (typeof traits === 'string') {
        try {
          traits = JSON.parse(traits);
        } catch (e) {
          console.error('❌ Failed to parse character_traits:', e);
          traits = {};
        }
      }
      
      return {
        id: row.character_id,
        name: row.name,
        profileImageURL: row.profile_image_url,
        fullBodyImageURL: row.full_body_image_url,
        createdAt: row.created_at,
        isUserCreated: row.is_user_created,
        characterTraits: traits
      };
    });

    console.log(`✅ Loaded ${characters.length} characters for user ${userId}`);
    res.json({ success: true, characters });
  } catch (error) {
    console.error('❌ Error loading characters:', error);
    res.status(500).json({ error: 'Failed to load characters', details: error.message });
  }
});

// Karakter fotoğraflarını Supabase Storage'a yükle ve Public URL'i kaydet
app.post('/api/save-character-images', async (req, res) => {
  try {
    const { userId, characterId, profileImageBase64, fullBodyImageBase64 } = req.body;

    if (!userId || !characterId) {
      return res.status(400).json({ error: 'userId and characterId are required' });
    }

    if (!supabase) {
      return res.status(500).json({ error: 'Supabase not configured' });
    }

    // Upload images to Supabase Storage and get Public URLs
    let profileImagePublicUrl = null;
    let fullBodyImagePublicUrl = null;

    if (profileImageBase64) {
      const filePath = `avatars/${characterId}_profile.jpg`;
      profileImagePublicUrl = await uploadBase64ToSupabase(profileImageBase64, filePath);
      if (!profileImagePublicUrl) {
        console.error('❌ Failed to upload profile image to Supabase Storage');
      }
    }

    if (fullBodyImageBase64) {
      const filePath = `avatars/${characterId}_fullbody.jpg`;
      fullBodyImagePublicUrl = await uploadBase64ToSupabase(fullBodyImageBase64, filePath);
      if (!fullBodyImagePublicUrl) {
        console.error('❌ Failed to upload full body image to Supabase Storage');
      }
    }

    // Karakteri bul ve güncelle (Public URLs ile)
    const { data: existingCharacter, error: fetchError } = await supabase
      .from('characters')
      .select('*')
      .eq('user_id', userId)
      .eq('character_id', characterId)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') { // PGRST116 = not found, bu normal
      console.error('❌ Supabase error fetching character:', fetchError);
      return res.status(500).json({ error: 'Failed to fetch character', details: fetchError.message });
    }

    if (existingCharacter) {
      // Karakter var, güncelle (Public URLs ile)
      const updateData = {};
      if (profileImagePublicUrl) {
        updateData.profile_image_url = profileImagePublicUrl;
      }
      if (fullBodyImagePublicUrl) {
        updateData.full_body_image_url = fullBodyImagePublicUrl;
      }

      if (Object.keys(updateData).length > 0) {
        const { error: updateError } = await supabase
          .from('characters')
          .update(updateData)
          .eq('user_id', userId)
          .eq('character_id', characterId);

        if (updateError) {
          console.error('❌ Supabase error updating character images:', updateError);
          return res.status(500).json({ error: 'Failed to update character images', details: updateError.message });
        }

        console.log(`✅ Updated character images for character ${characterId} and user ${userId}`);
        console.log(`📸 Profile URL: ${profileImagePublicUrl || 'not updated'}`);
        console.log(`📸 Full Body URL: ${fullBodyImagePublicUrl || 'not updated'}`);
      }

      res.json({ 
        success: true,
        profileImageURL: profileImagePublicUrl,
        fullBodyImageURL: fullBodyImagePublicUrl
      });
    } else {
      // Karakter yok, oluşturulamaz (bu endpoint sadece mevcut karakterler için)
      console.log(`⚠️ Character ${characterId} not found for user ${userId}, skipping image save`);
      res.json({ success: true, message: 'Character not found, images not saved' });
    }
  } catch (error) {
    console.error('❌ Error saving character images:', error);
    res.status(500).json({ error: 'Failed to save character images', details: error.message });
  }
});

// Mesajları kaydet (Supabase)
app.post('/api/save-messages', async (req, res) => {
  try {
    const { userId, characterId, messages } = req.body;

    if (!userId || !characterId) {
      return res.status(400).json({ error: 'userId and characterId are required' });
    }

    if (!messages) {
      return res.status(400).json({ error: 'messages is required' });
    }

    if (!supabase) {
      return res.status(500).json({ error: 'Supabase not configured' });
    }

    // Önce mevcut mesajları sil (upsert için)
    await supabase
      .from('messages')
      .delete()
      .eq('user_id', userId)
      .eq('character_id', characterId);

    // Process messages: upload images to Supabase Storage if they are Base64
    const messagesToInsert = await Promise.all(messages.map(async (msg) => {
      let imageUrl = msg.imageURL || null;

      // If imageURL is Base64, upload to Storage
      if (imageUrl && (imageUrl.startsWith('data:image') || imageUrl.startsWith('file://'))) {
        // Extract base64 if it's a data URI
        if (imageUrl.startsWith('data:image')) {
          const filePath = `chat_images/${msg.id}.jpg`;
          const publicUrl = await uploadBase64ToSupabase(imageUrl, filePath);
          if (publicUrl) {
            imageUrl = publicUrl;
            console.log(`✅ Uploaded message image to Storage: ${filePath}`);
          } else {
            console.error(`❌ Failed to upload message image for message ${msg.id}`);
            imageUrl = null; // Don't save if upload failed
          }
        }
        // If it's a file:// URL, skip (iOS will handle local files)
        // We only upload Base64 images from iOS
      }

      return {
        user_id: userId,
        character_id: characterId,
        message_id: msg.id,
        text: msg.text,
        is_user: msg.isUser,
        timestamp: msg.timestamp,
        image_url: imageUrl
      };
    }));

    const { data, error } = await supabase
      .from('messages')
      .insert(messagesToInsert);

    if (error) {
      console.error('❌ Supabase error saving messages:', error);
      return res.status(500).json({ error: 'Failed to save messages', details: error.message });
    }

    console.log(`✅ Saved ${messages.length} messages for user ${userId}, character ${characterId}`);
    res.json({ success: true, count: messages.length });
  } catch (error) {
    console.error('❌ Error saving messages:', error);
    res.status(500).json({ error: 'Failed to save messages', details: error.message });
  }
});

// Mesajları yükle (Supabase)
app.get('/api/load-messages', async (req, res) => {
  try {
    const { userId, characterId } = req.query;

    if (!userId || !characterId) {
      return res.status(400).json({ error: 'userId and characterId are required' });
    }

    if (!supabase) {
      return res.status(500).json({ error: 'Supabase not configured' });
    }

    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('user_id', userId)
      .eq('character_id', characterId)
      .order('timestamp', { ascending: true });

    if (error) {
      console.error('❌ Supabase error loading messages:', error);
      return res.status(500).json({ error: 'Failed to load messages', details: error.message });
    }

    // Supabase'den gelen verileri iOS formatına çevir
    const messages = (data || []).map(row => ({
      id: row.message_id,
      text: row.text,
      isUser: row.is_user,
      timestamp: row.timestamp,
      imageURL: row.image_url
    }));

    console.log(`✅ Loaded ${messages.length} messages for user ${userId}, character ${characterId}`);
    res.json({ success: true, messages });
  } catch (error) {
    console.error('❌ Error loading messages:', error);
    res.status(500).json({ error: 'Failed to load messages', details: error.message });
  }
});

// Bir karakteri sil (Supabase)
app.delete('/api/delete-character', async (req, res) => {
  try {
    const { userId, characterId } = req.body;

    if (!userId || !characterId) {
      return res.status(400).json({ error: 'userId and characterId are required' });
    }

    if (!supabase) {
      return res.status(500).json({ error: 'Supabase not configured' });
    }

    // Önce karakterin mesajlarını sil
    await supabase
      .from('messages')
      .delete()
      .eq('user_id', userId)
      .eq('character_id', characterId);

    // Sonra karakteri sil
    const { error } = await supabase
      .from('characters')
      .delete()
      .eq('user_id', userId)
      .eq('character_id', characterId);

    if (error) {
      console.error('❌ Supabase error deleting character:', error);
      return res.status(500).json({ error: 'Failed to delete character', details: error.message });
    }

    console.log(`✅ Deleted character ${characterId} and its messages for user ${userId}`);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error deleting character:', error);
    res.status(500).json({ error: 'Failed to delete character', details: error.message });
  }
});

// Bir karakterin mesajlarını sil (Supabase)
app.delete('/api/delete-messages', async (req, res) => {
  try {
    const { userId, characterId } = req.body;

    if (!userId || !characterId) {
      return res.status(400).json({ error: 'userId and characterId are required' });
    }

    if (!supabase) {
      return res.status(500).json({ error: 'Supabase not configured' });
    }

    const { error } = await supabase
      .from('messages')
      .delete()
      .eq('user_id', userId)
      .eq('character_id', characterId);

    if (error) {
      console.error('❌ Supabase error deleting messages:', error);
      return res.status(500).json({ error: 'Failed to delete messages', details: error.message });
    }

    console.log(`✅ Deleted messages for character ${characterId} and user ${userId}`);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Error deleting messages:', error);
    res.status(500).json({ error: 'Failed to delete messages', details: error.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

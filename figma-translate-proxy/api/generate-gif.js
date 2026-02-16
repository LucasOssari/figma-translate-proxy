// api/generate-gif.js
const GIFEncoder = require('gifencoder');
const { createCanvas, loadImage } = require('canvas');

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    const { frames, width, height, fps = 30 } = req.body;
    
    if (!frames || !Array.isArray(frames) || frames.length === 0) {
      return res.status(400).json({ error: 'No frames provided' });
    }
    
    // Créer l'encodeur GIF
    const encoder = new GIFEncoder(width, height);
    
    // Démarrer l'encodage
    const chunks = [];
    encoder.createReadStream().on('data', chunk => chunks.push(chunk));
    
    encoder.start();
    encoder.setRepeat(0); // Loop infiniment
    encoder.setDelay(Math.round(1000 / fps)); // Délai entre frames
    encoder.setQuality(10); // Qualité (1-20, 1 = meilleur)
    
    // Créer un canvas
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    
    // Ajouter chaque frame
    for (const frameData of frames) {
      // Convertir base64 en image
      const img = await loadImage(`data:image/png;base64,${frameData}`);
      
      // Dessiner sur le canvas
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      
      // Ajouter au GIF
      encoder.addFrame(ctx);
    }
    
    encoder.finish();
    
    // Attendre que tous les chunks soient prêts
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Créer le buffer final
    const buffer = Buffer.concat(chunks);
    
    // Retourner le GIF en base64
    res.status(200).json({
      success: true,
      gif: buffer.toString('base64')
    });
    
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
};

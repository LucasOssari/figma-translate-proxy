const GIFEncoder = require('gifencoder');
const { createCanvas, loadImage } = require('canvas');

module.exports = async (req, res) => {
  // CORS headers - TRÈS IMPORTANT
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Gérer la requête OPTIONS (preflight)
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
    encoder.setRepeat(0);
    encoder.setDelay(Math.round(1000 / fps));
    encoder.setQuality(10);
    
    // Créer un canvas
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    
    // Ajouter chaque frame
    for (const frameData of frames) {
      const img = await loadImage(`data:image/png;base64,${frameData}`);
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      encoder.addFrame(ctx);
    }
    
    encoder.finish();
    
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const buffer = Buffer.concat(chunks);
    
    res.status(200).json({
      success: true,
      gif: buffer.toString('base64')
    });
    
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
};

const fs = require('fs');
const path = require('path');
const https = require('https');

// 256x256 clean offline grid placeholder PNG buffer
const FALLBACK_TILE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAQAAAAEAAQMAAABmvDolAAAAA1BMVEW4uLid89/CAAAAAXRSTlMAQObYZgAAACNJREFUeNrtwTEBAAAAwqD1T20LL6AAAAAAAAAAAAAAAADgbx4EAAHj1+jUAAAAAElFTkSuQmCC',
  'base64'
);

function createTileMiddleware(tileDir) {
  return (req, res, next) => {
    const { z, x, y } = req.params;
    // Strip any .png extension
    const cleanY = (y || '').replace(/\.png$/, '');

    const numZ = parseInt(z, 10);
    const numX = parseInt(x, 10);
    const numY = parseInt(cleanY, 10);

    if (isNaN(numZ) || isNaN(numX) || isNaN(numY) || numZ < 0 || numZ > 20) {
      res.setHeader('Content-Type', 'image/png');
      return res.end(FALLBACK_TILE_PNG);
    }

    const tilePath = path.join(tileDir, String(numZ), String(numX), `${numY}.png`);

    // 1. Serve immediately from local disk cache if tile exists
    if (fs.existsSync(tilePath)) {
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      if (typeof res.sendFile === 'function') {
        return res.sendFile(tilePath);
      }
      return res.end(fs.readFileSync(tilePath));
    }

    // 2. Fetch tile from OpenStreetMap tile server and cache to local disk
    const tileUrl = `https://tile.openstreetmap.org/${numZ}/${numX}/${numY}.png`;

    const osmReq = https.get(
      tileUrl,
      {
        headers: {
          'User-Agent': 'LifeLink-BloodApp/1.1 (blood community tile viewer; info@lifelink.org)'
        },
        timeout: 4500
      },
      (osmRes) => {
        if (osmRes.statusCode === 200) {
          const chunks = [];
          osmRes.on('data', (chunk) => chunks.push(chunk));
          osmRes.on('end', () => {
            const buffer = Buffer.concat(chunks);
            const dir = path.dirname(tilePath);
            try {
              if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
              fs.writeFileSync(tilePath, buffer);
            } catch (e) {}

            res.setHeader('Content-Type', 'image/png');
            res.setHeader('Cache-Control', 'public, max-age=86400');
            res.end(buffer);
          });
        } else {
          res.setHeader('Content-Type', 'image/png');
          res.setHeader('Cache-Control', 'public, max-age=86400');
          res.end(FALLBACK_TILE_PNG);
        }
      }
    );

    osmReq.on('error', () => {
      // Offline fallback: serve clean grid placeholder
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.end(FALLBACK_TILE_PNG);
    });

    osmReq.on('timeout', () => {
      osmReq.destroy();
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.end(FALLBACK_TILE_PNG);
    });
  };
}

module.exports = {
  createTileMiddleware,
  FALLBACK_TILE_PNG
};

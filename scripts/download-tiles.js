/**
 * LifeLink Offline Tile Downloader Script
 * Downloads raster map tiles for a specified geographic bounding box and zoom range
 * and stores them in the local static tiles directory (TILE_DIR).
 *
 * Usage:
 *   node scripts/download-tiles.js
 *   node scripts/download-tiles.js --minZoom 10 --maxZoom 13
 *   node scripts/download-tiles.js --bbox 76.8,12.4,78.4,13.6 --minZoom 11 --maxZoom 13
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

// Default bounding box: Greater Bengaluru Region (~100 km radius)
const DEFAULT_BBOX = [76.8, 12.4, 78.4, 13.6]; // [minLng, minLat, maxLng, maxLat]
const DEFAULT_MIN_ZOOM = 10;
const DEFAULT_MAX_ZOOM = 13;

const TILE_DIR = process.env.TILE_DIR
  ? path.resolve(process.env.TILE_DIR)
  : path.join(__dirname, '..', 'public', 'tiles');

// Parse CLI options
const args = process.argv.slice(2);
function getArg(flag, fallback) {
  const idx = args.indexOf(flag);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  return fallback;
}

const bboxStr = getArg('--bbox', DEFAULT_BBOX.join(','));
const [minLng, minLat, maxLng, maxLat] = bboxStr.split(',').map(Number);
const minZoom = parseInt(getArg('--minZoom', DEFAULT_MIN_ZOOM), 10);
const maxZoom = parseInt(getArg('--maxZoom', DEFAULT_MAX_ZOOM), 10);

// Coordinate to tile math
function lng2tile(lon, zoom) {
  return Math.floor(((lon + 180) / 360) * Math.pow(2, zoom));
}

function lat2tile(lat, zoom) {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * Math.pow(2, zoom)
  );
}

// 1x1 transparent PNG fallback byte buffer (68 bytes)
const TRANSPARENT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function downloadTile(url, destPath) {
  return new Promise((resolve) => {
    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (fs.existsSync(destPath)) {
      return resolve({ cached: true, success: true });
    }

    const client = url.startsWith('https') ? https : http;
    const req = client.get(
      url,
      {
        headers: {
          'User-Agent': 'LifeLink-OfflineTilesCache/1.0 (blood community offline map)'
        },
        timeout: 8000
      },
      (res) => {
        if (res.statusCode === 200) {
          const file = fs.createWriteStream(destPath);
          res.pipe(file);
          file.on('finish', () => {
            file.close();
            resolve({ success: true, cached: false });
          });
        } else {
          // If server responds with error, write fallback tile
          fs.writeFileSync(destPath, TRANSPARENT_PNG);
          resolve({ success: false, status: res.statusCode });
        }
      }
    );

    req.on('error', () => {
      // Offline fallback: write transparent PNG so map engine loads without crashing
      try {
        fs.writeFileSync(destPath, TRANSPARENT_PNG);
      } catch (e) {}
      resolve({ success: false, offline: true });
    });

    req.on('timeout', () => {
      req.destroy();
      try {
        fs.writeFileSync(destPath, TRANSPARENT_PNG);
      } catch (e) {}
      resolve({ success: false, timeout: true });
    });
  });
}

async function run() {
  console.log('===========================================================');
  console.log('🗺️  LIFELINK OFFLINE TILE PRE-DOWNLOADER');
  console.log('===========================================================');
  console.log(`Target Directory : ${TILE_DIR}`);
  console.log(`Bounding Box     : [${minLng}, ${minLat}] to [${maxLng}, ${maxLat}]`);
  console.log(`Zoom Range       : ${minZoom} -> ${maxZoom}`);
  console.log('-----------------------------------------------------------');

  if (!fs.existsSync(TILE_DIR)) {
    fs.mkdirSync(TILE_DIR, { recursive: true });
  }

  // Calculate total tile queue
  const queue = [];
  for (let z = minZoom; z <= maxZoom; z++) {
    const startX = lng2tile(minLng, z);
    const endX = lng2tile(maxLng, z);
    const startY = lat2tile(maxLat, z); // Note: tile Y increases southward
    const endY = lat2tile(minLat, z);

    const minX = Math.min(startX, endX);
    const maxX = Math.max(startX, endX);
    const minY = Math.min(startY, endY);
    const maxY = Math.max(startY, endY);

    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        queue.push({ z, x, y });
      }
    }
  }

  console.log(`Total tiles to synchronize: ${queue.length}`);

  let downloaded = 0;
  let cached = 0;
  let failed = 0;

  for (let i = 0; i < queue.length; i++) {
    const { z, x, y } = queue[i];
    const dest = path.join(TILE_DIR, String(z), String(x), `${y}.png`);
    const tileUrl = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;

    const result = await downloadTile(tileUrl, dest);
    if (result.cached) cached++;
    else if (result.success) downloaded++;
    else failed++;

    if ((i + 1) % 15 === 0 || i === queue.length - 1) {
      process.stdout.write(
        `\rProgress: ${i + 1}/${queue.length} tiles (Downloaded: ${downloaded}, Cached: ${cached}, Offline: ${failed})`
      );
    }

    // Gentle rate limit for tile server polite usage policy
    if (!result.cached) {
      await sleep(100);
    }
  }

  console.log('\n-----------------------------------------------------------');
  console.log('✅ Offline tile caching process complete!');
  console.log(`Tiles available for offline map rendering in: ${TILE_DIR}`);
  console.log('===========================================================');
}

if (require.main === module) {
  run().catch((err) => {
    console.error('Fatal error in tile downloader:', err.message);
  });
}

module.exports = {
  lng2tile,
  lat2tile,
  downloadTile
};

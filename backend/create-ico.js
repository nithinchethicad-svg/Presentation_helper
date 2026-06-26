const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const pngPath = path.join(__dirname, '..', 'frontend', 'public', 'favicon.png');
const icoPath = path.join(__dirname, '..', 'frontend', 'public', 'favicon.ico');

async function convert() {
  try {
    console.log('Reading and resizing PNG...');
    // Resize to 256x256 to ensure it works beautifully on all Windows DPI scales
    const pngBuffer = await sharp(pngPath)
      .resize(256, 256)
      .png()
      .toBuffer();

    console.log('Creating ICO header...');
    const header = Buffer.alloc(22);
    
    // Icon Dir Header (6 bytes)
    header.writeUInt16LE(0, 0);     // Reserved
    header.writeUInt16LE(1, 2);     // Type (1 = Icon)
    header.writeUInt16LE(1, 4);     // Image count (1)
    
    // Icon Directory Entry (16 bytes)
    header.writeUInt8(0, 6);        // Width (0 means 256)
    header.writeUInt8(0, 7);        // Height (0 means 256)
    header.writeUInt8(0, 8);        // Color palette (0 = no palette)
    header.writeUInt8(0, 9);        // Reserved
    header.writeUInt16LE(1, 10);    // Color planes (1)
    header.writeUInt16LE(32, 12);   // Bits per pixel (32)
    header.writeUInt32LE(pngBuffer.length, 14); // Size of PNG data
    header.writeUInt32LE(22, 18);   // Offset of PNG data (22)
    
    console.log('Writing ICO file to:', icoPath);
    const icoBuffer = Buffer.concat([header, pngBuffer]);
    fs.writeFileSync(icoPath, icoBuffer);
    console.log('ICO file created successfully.');
  } catch (err) {
    console.error('Error converting PNG to ICO:', err);
    process.exit(1);
  }
}

convert();

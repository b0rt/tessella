const fs = require('fs');
const path = require('path');

const libDir = path.join(__dirname, '..', 'lib');

// Ensure directories exist
if (!fs.existsSync(libDir)) {
  fs.mkdirSync(libDir, { recursive: true });
}

// Copy Three.js
const threeSrc = path.join(__dirname, '..', 'node_modules', 'three', 'build', 'three.min.js');
const threeDest = path.join(libDir, 'three.min.js');

if (fs.existsSync(threeSrc)) {
  fs.copyFileSync(threeSrc, threeDest);
  console.log('✓ Copied three.min.js to /lib');
} else {
  console.error('✗ Could not find three.min.js');
}

console.log('✓ All libraries ready');

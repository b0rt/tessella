const fs = require("fs");
const path = require("path");

const FONTS_DIR = path.join(__dirname, "..", "fonts");
const NODE_MODULES = path.join(__dirname, "..", "node_modules");

const FONTS = [
  // JetBrains Mono
  { src: "@fontsource/jetbrains-mono/files/jetbrains-mono-latin-300-normal.woff2", dest: "JetBrainsMono-Light.woff2" },
  { src: "@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2", dest: "JetBrainsMono-Regular.woff2" },
  { src: "@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff2", dest: "JetBrainsMono-Medium.woff2" },
  { src: "@fontsource/jetbrains-mono/files/jetbrains-mono-latin-700-normal.woff2", dest: "JetBrainsMono-Bold.woff2" },
  // Space Mono
  { src: "@fontsource/space-mono/files/space-mono-latin-400-normal.woff2", dest: "SpaceMono-Regular.woff2" },
  { src: "@fontsource/space-mono/files/space-mono-latin-700-normal.woff2", dest: "SpaceMono-Bold.woff2" },
  // Playfair Display
  { src: "@fontsource/playfair-display/files/playfair-display-latin-400-normal.woff2", dest: "PlayfairDisplay-Regular.woff2" },
  { src: "@fontsource/playfair-display/files/playfair-display-latin-700-normal.woff2", dest: "PlayfairDisplay-Bold.woff2" },
  { src: "@fontsource/playfair-display/files/playfair-display-latin-900-normal.woff2", dest: "PlayfairDisplay-Black.woff2" }
];

function main() {
  // Create fonts directory if it doesn't exist
  if (!fs.existsSync(FONTS_DIR)) {
    fs.mkdirSync(FONTS_DIR, { recursive: true });
  }

  console.log("Copying fonts from node_modules...");

  for (const font of FONTS) {
    const srcPath = path.join(NODE_MODULES, font.src);
    const destPath = path.join(FONTS_DIR, font.dest);

    try {
      if (fs.existsSync(srcPath)) {
        fs.copyFileSync(srcPath, destPath);
        console.log(`  ✓ ${font.dest}`);
      } else {
        console.log(`  ✗ ${font.dest} (source not found: ${font.src})`);
      }
    } catch (err) {
      console.log(`  ✗ ${font.dest} (${err.message})`);
    }
  }

  console.log("Fonts ready.");
}

main();

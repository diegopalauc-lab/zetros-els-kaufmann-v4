import {stat} from "node:fs/promises";
import items from "../src/items.json" with {type: "json"};

const references = items.flatMap(({photos, categoryPhotos = []}) => [...photos, ...categoryPhotos]);
const files = [
  "logo-els.png",
  "logo-kaufmann.png",
  ...new Set(references.map((photo) => `reference/${photo}`)),
];
const missing = [];
for (const file of files) {
  const info = await stat(new URL(`../public/${file}`, import.meta.url)).catch(() => null);
  if (!info?.isFile() || info.size === 0) missing.push(file);
}
if (missing.length) {
  console.error("Despliegue detenido. Faltan imágenes en public:");
  for (const file of missing) console.error(`  public/${file}`);
  process.exitCode = 1;
} else {
  console.log(`Verificación correcta: ${references.length} fotos de referencia y ambos logos.`);
}

import type { Box, Pixels, Reference, ScanCard } from './recognize.ts';

export const artworkUrl = (id: number) => `${import.meta.env.BASE_URL}assets/supports/${id}.png`;
const referenceUrl = (id: number) => `${import.meta.env.BASE_URL}assets/supports/scanner/${id}.webp`;

async function imageCanvas(source: string, maxWidth?: number): Promise<HTMLCanvasElement> {
  const image = new Image();
  image.src = source;
  await image.decode();
  const scale = maxWidth ? Math.min(1, maxWidth / image.naturalWidth) : 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(image.naturalWidth * scale);
  canvas.height = Math.round(image.naturalHeight * scale);
  canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}
export const pixels = (canvas: HTMLCanvasElement): Pixels => {
  const { width, height } = canvas;
  return { width, height, data: canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, width, height).data };
};
export async function screenshotCanvas(file: File): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(file);
  try { return await imageCanvas(url, 600); }
  finally { URL.revokeObjectURL(url); }
}
export function cropUrl(canvas: HTMLCanvasElement, box: Box): string {
  const crop = document.createElement('canvas');
  crop.width = Math.round(box.width); crop.height = Math.round(box.height);
  crop.getContext('2d')!.drawImage(canvas, box.x, box.y, box.width, box.height, 0, 0, crop.width, crop.height);
  return crop.toDataURL('image/jpeg', .88);
}
const decoded = (url: string) => imageCanvas(url).then(pixels, () => null);
/** Badge candidates tried per rarity before recognition goes without that rarity's badge. */
export const BADGE_TRIES = 3;

/**
 * The catalog can list a card whose reference was never generated (`scripts/scanner-artwork.mjs` skips cards without
 * source artwork). Such a card is left out with a console warning and cannot be matched; the rest still can. Only
 * when nothing usable loads does this reject, so the page reports that the artwork could not load.
 */
export async function loadReferences(cards: ScanCard[]): Promise<Reference[]> {
  const missing: string[] = [];
  // Every card of a rarity carries the same badge, so the first one that loads supplies its template.
  const badges = new Map<number, Pixels>();
  await Promise.all((['R', 'SR', 'SSR'] as const).map(async rarity => {
    for (const card of cards.filter(c => c.rarity === rarity).slice(0, BADGE_TRIES)) {
      const image = await decoded(artworkUrl(card.id));
      if (image) { badges.set(card.id, image); return; }
      missing.push(artworkUrl(card.id));
    }
  }));
  const queue = cards.filter(c => c.rarity !== 'R' || badges.has(c.id));
  const references: Reference[] = [];
  // Limit parallel image decoding on phones.
  await Promise.all(Array.from({ length: 6 }, async () => {
    for (let card = queue.shift(); card; card = queue.shift()) {
      const image = badges.get(card.id) ?? null;
      const artwork = card.rarity === 'R' ? null : await decoded(referenceUrl(card.id));
      if (card.rarity !== 'R' && !artwork) missing.push(referenceUrl(card.id));
      if (image || artwork) references.push({ ...card, image, artwork });
    }
  }));
  if (missing.length) console.warn(`Scanner images could not load, so a card without its reference cannot be matched: ${missing.sort().join(', ')}`);
  if (!badges.size || !references.some(r => r.artwork)) throw new Error('No scanner references could load');
  return references.sort((a, b) => a.id - b.id);
}

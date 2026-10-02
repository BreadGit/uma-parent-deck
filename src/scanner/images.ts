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
export async function loadReferences(cards: ScanCard[]): Promise<Reference[]> {
  const rBadge = cards.find(c => c.rarity === 'R')?.id;
  const queue = cards.filter(c => c.rarity !== 'R' || c.id === rBadge);
  const badges = new Set(['R', 'SR', 'SSR'].map(rarity => cards.find(c => c.rarity === rarity)?.id));
  const references: Reference[] = [];
  // Limit parallel image decoding on phones.
  await Promise.all(Array.from({ length: 6 }, async () => {
    for (let card = queue.shift(); card; card = queue.shift()) references.push({ ...card,
      image: badges.has(card.id) ? pixels(await imageCanvas(artworkUrl(card.id))) : null,
      artwork: card.rarity === 'R' ? null : pixels(await imageCanvas(referenceUrl(card.id))),
    });
  }));
  return references.sort((a, b) => a.id - b.id);
}

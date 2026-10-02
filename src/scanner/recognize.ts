import type { CardType, Rarity } from '../types.ts';

export interface Pixels { width: number; height: number; data: Uint8ClampedArray }
export interface ScanCard { id: number; name: string; charName: string; rarity: Rarity; type: CardType }
export interface Reference extends ScanCard { image: Pixels; artwork: Pixels | null }
export interface Box { x: number; y: number; width: number; height: number }
export interface Match { id: number; error: number }
export interface Detection { box: Box; candidates: Match[]; lb: number | null; confident: boolean }
export interface ScanResult { detections: Detection[]; ignoredR: number }
interface Slot { box: Box; rarity: Rarity | null; inferred: boolean }

/** Area sampling makes matching insensitive to JPEG noise and small differences in screenshot scale. */
export function sample(image: Pixels, x: number, y: number, width = 1, height = 1): number[] {
  const rgb = [0, 0, 0];
  let count = 0;
  for (let iy = Math.max(0, Math.floor(y)); iy < Math.min(image.height, Math.ceil(y + height)); iy++) {
    for (let ix = Math.max(0, Math.floor(x)); ix < Math.min(image.width, Math.ceil(x + width)); ix++) {
      const p = (iy * image.width + ix) * 4;
      for (let c = 0; c < 3; c++) rgb[c]! += image.data[p + c]!;
      count++;
    }
  }
  return rgb.map(v => v / Math.max(1, count));
}

export function resizeCrop(image: Pixels, box: Box, width: number, height: number): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const rgb = sample(image, box.x + x * box.width / width, box.y + y * box.height / height, box.width / width, box.height / height);
    data.set([...rgb, 255], (y * width + x) * 4);
  }
  return { width, height, data };
}

function pixelError(a: number, b: number) { const d = a - b; return d * d; }

/** Match a template with early rejection. The sample order reaches across the patch before filling it in. */
function search(image: Pixels, patch: Pixels, stride: number, sampleStep: number, limit = .06): { error: number; x: number; y: number } {
  const offsets: [number, number][] = [];
  for (let y = 1; y < patch.height - 1; y += sampleStep) for (let x = 1; x < patch.width - 1; x += sampleStep) offsets.push([x, y]);
  offsets.sort((a, b) => ((a[0] * 13 + a[1] * 7) % 31) - ((b[0] * 13 + b[1] * 7) % 31));
  const from = offsets.map(([x, y]) => (y * patch.width + x) * 4);
  const to = offsets.map(([x, y]) => (y * image.width + x) * 4);
  let best = limit * offsets.length * 3 * 255 * 255, bestX = 0, bestY = 0, found = false;
  for (let y = 0; y <= image.height - patch.height; y += stride) for (let x = 0; x <= image.width - patch.width; x += stride) {
    let error = 0;
    const base = (y * image.width + x) * 4;
    for (let i = 0; i < from.length; i++) {
      const p = from[i]!, q = base + to[i]!;
      error += pixelError(image.data[q]!, patch.data[p]!) + pixelError(image.data[q + 1]!, patch.data[p + 1]!) + pixelError(image.data[q + 2]!, patch.data[p + 2]!);
      if (error >= best) break;
    }
    if (error < best) { best = error; bestX = x; bestY = y; found = true; }
  }
  return { error: found ? best / (offsets.length * 3 * 255 * 255) : Infinity, x: bestX, y: bestY };
}

function badges(image: Pixels, references: Reference[]): Slot[] {
  // Portrait support-card lists use five columns. Coordinates are discovered from the rarity badges;
  // width determines their scale, so both supplied phone sizes and resized screenshots use the same path.
  const scale = image.width * .17 / 128;
  const found: { box: Box; rarity: Rarity; error: number }[] = [];
  for (const rarity of ['SSR', 'SR', 'R'] as const) {
    const ref = references.find(r => r.rarity === rarity);
    if (!ref) continue;
    const patch = resizeCrop(ref.image, { x: 5, y: 5, width: 30, height: 27 }, Math.round(30 * scale), Math.round(27 * scale));
    // A cheap sparse pass leaves only a small number of locations for full template comparison.
    const columns = Array.from({ length: 5 }, (_, i) => image.width * (.039 + i * .1895) + 5 * scale);
    for (let y = 0; y < image.height - patch.height; y++) for (const column of columns) for (let x = Math.round(column - 4); x <= column + 4; x++) {
      let error = 0, n = 0;
      for (let py = 2; py < patch.height - 2; py += 3) for (let px = 2; px < patch.width - 2; px += 3) {
        const p = (py * patch.width + px) * 4, q = ((y + py) * image.width + x + px) * 4;
        for (let c = 0; c < 3; c++) error += pixelError(image.data[q + c]!, patch.data[p + c]!);
        n += 3;
      }
      error /= n * 255 * 255;
      if (error >= .03) continue;
      error = 0;
      for (let py = 0; py < patch.height; py++) for (let px = 0; px < patch.width; px++) {
        const p = (py * patch.width + px) * 4, q = ((y + py) * image.width + x + px) * 4;
        for (let c = 0; c < 3; c++) error += pixelError(image.data[q + c]!, patch.data[p + c]!);
      }
      error /= patch.width * patch.height * 3 * 255 * 255;
      if (error < .025) found.push({ box: { x: x - 5 * scale, y: y - 5 * scale, width: 128 * scale, height: 174 * scale }, rarity, error });
    }
  }
  const kept: typeof found = [];
  for (const f of found.sort((a, b) => a.error - b.error)) {
    if (kept.some(k => Math.abs(k.box.x - f.box.x) < 50 * scale && Math.abs(k.box.y - f.box.y) < 85 * scale)) continue;
    if (f.box.x < 0 || f.box.x + f.box.width > image.width || f.box.y < 0 || f.box.y + f.box.height > image.height) continue;
    kept.push(f);
  }
  const rows: (typeof kept)[] = [];
  for (const badge of kept.sort((a, b) => a.box.y - b.box.y)) {
    const row = rows.find(r => Math.abs(r[0]!.box.y - badge.box.y) < 8);
    if (row) row.push(badge); else rows.push([badge]);
  }
  const gridRows = rows.filter(r => r.length >= 2);
  const result: Slot[] = [];
  for (const row of gridRows) {
    const y = row.map(b => b.box.y).sort((a, b) => a - b)[Math.floor(row.length / 2)]!;
    const srRow = row.filter(b => b.rarity === 'SR').length >= 3;
    for (let column = 0; column < 5; column++) {
      const x = image.width * (.039 + column * .1895);
      const badge = row.find(b => Math.abs(b.box.x - x) < 10);
      result.push({ box: badge?.box ?? { x, y, width: 128 * scale, height: 174 * scale },
        rarity: badge ? (srRow && badge.rarity === 'R' ? 'SR' : badge.rarity) : null, inferred: !badge });
    }
  }
  // A scrolled first row can lose its badges while keeping the art and diamonds visible.
  const first = gridRows[0]?.[0]?.box;
  if (first) {
    const y = first.y - image.width * .254;
    if (y >= 0) for (let column = 0; column < 5; column++) result.unshift({ box: { ...first, x: image.width * (.039 + column * .1895), y }, rarity: null, inferred: true });
  }
  return result.sort((a, b) => Math.abs(a.box.y - b.box.y) < 10 ? a.box.x - b.box.x : a.box.y - b.box.y);
}

const TYPE_RGB: [CardType, number[]][] = [
  ['speed', [20, 174, 234]], ['stamina', [255, 104, 100]], ['power', [255, 165, 15]],
  ['guts', [255, 100, 170]], ['wit', [0, 192, 140]], ['pal', [255, 191, 0]],
];
function cardType(tile: Pixels): CardType | null {
  const votes = new Map<CardType, number>();
  for (let y = 3; y < 17; y++) for (let x = 64; x < 77; x++) {
    const p = (y * tile.width + x) * 4;
    const types = TYPE_RGB.map(([type, color]) => ({ type, error: color.reduce((s, v, i) => s + pixelError(v, tile.data[p + i]!), 0) })).sort((a, b) => a.error - b.error);
    if (types[0]!.error < 3000) votes.set(types[0]!.type, (votes.get(types[0]!.type) ?? 0) + 1);
  }
  const best = [...votes].sort((a, b) => b[1] - a[1])[0];
  return best && best[1] >= 20 ? best[0] : null;
}

/** Read the four diamonds, never infer LB from the card's training level. */
export function readLimitBreak(tile: Pixels): number | null {
  const lit: boolean[] = [];
  for (let i = 0; i < 4; i++) {
    // Sample the interior above the lower tip, where the transparent edge picks up the artwork.
    const rgb = sample(tile, 5 + i * 9.5, 94, 3, 3);
    const [r, g, b] = rgb as [number, number, number];
    if (g > r + 30 && b > r + 30 && g > 125) lit.push(true);
    else if (Math.max(...rgb) - Math.min(...rgb) < 38 && r > 85 && r < 220) lit.push(false);
    else return null;
  }
  const lb = lit.filter(Boolean).length;
  return lit.every((on, i) => on === (i < lb)) ? lb : null;
}

function artworkPatch(artwork: Pixels, width: number): Pixels {
  // Keep the full composition, excluding the frame, rarity/type badges and level/diamond strip.
  const box = { x: artwork.width * .07, y: artwork.height * .2,
    width: artwork.width * .86, height: artwork.height * .64 };
  return resizeCrop(artwork, box, width, Math.round(width * box.height / box.width));
}

export function recognize(image: Pixels, references: Reference[], progress?: (done: number, total: number) => void): ScanResult {
  const slots = badges(image, references);
  const detections: Detection[] = [];
  let ignoredR = 0;
  const patches = new Map<number, Pixels[]>();
  for (const ref of references) {
    if (!ref.artwork) continue;
    patches.set(ref.id, Array.from({ length: 7 }, (_, i) => artworkPatch(ref.artwork!, 31 + i)));
  }
  for (const [index, slot] of slots.entries()) {
    progress?.(index, slots.length);
    if (slot.rarity === 'R') { ignoredR++; continue; }
    const tile = resizeCrop(image, slot.box, 80, 109);
    const lb = readLimitBreak(tile);
    if (slot.inferred && lb === null) continue;
    const coarse = resizeCrop(image, slot.box, 40, 55);
    const type = cardType(tile);
    const matches: (Match & { width: number })[] = [];
    for (const ref of references) {
      const compatibleType = !type || ref.type === type || (['pal', 'power'].includes(type) && ['pal', 'power', 'group'].includes(ref.type));
      if (!ref.artwork || (slot.rarity && ref.rarity !== slot.rarity) || !compatibleType) continue;
      let error = Infinity;
      let width = 0;
      for (const patch of patches.get(ref.id)!) {
        const match = search(coarse, patch, 1, Math.max(1, Math.floor(patch.width / 10)), error);
        if (match.error < error) { error = match.error; width = patch.width; }
      }
      matches.push({ id: ref.id, error, width });
    }
    matches.sort((a, b) => a.error - b.error);
    const candidates = matches.slice(0, 4).map(match => {
      const ref = references.find(r => r.id === match.id)!;
      let error = Infinity;
      for (let width = match.width * 2 - 1; width <= match.width * 2 + 1; width++) {
        const patch = artworkPatch(ref.artwork!, width);
        error = Math.min(error, search(tile, patch, 1, 1, error).error);
      }
      return { id: match.id, error };
    }).sort((a, b) => a.error - b.error).slice(0, 4);
    const first = candidates[0], second = candidates[1];
    const confident = !!first && first.error < .018 && (!second || first.error < second.error * .6);
    if (slot.inferred && (!confident || first!.error > .012)) continue;
    detections.push({ box: slot.box, candidates, lb, confident });
  }
  progress?.(slots.length, slots.length);
  // The fixed game toolbar can cover the entire bottom row. Keep isolated uncertain readings, but
  // leave an unreadable row to an overlapping screenshot rather than suggesting cards from toolbar art.
  const visible = detections.filter(d => {
    const row = detections.filter(other => Math.abs(other.box.y - d.box.y) < 8);
    return !(row.length >= 3 && row.filter(other => other.lb === null).length >= 2
      && !row.some(other => other.confident && other.lb !== null));
  });
  return { detections: visible, ignoredR };
}

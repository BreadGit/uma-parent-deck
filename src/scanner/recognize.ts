import type { CardType, Rarity } from '../types.ts';

export interface Pixels { width: number; height: number; data: Uint8ClampedArray }
export interface ScanCard { id: number; name: string; charName: string; rarity: Rarity; type: CardType }
export interface Reference extends ScanCard { image: Pixels | null; artwork: Pixels | null }
export interface Box { x: number; y: number; width: number; height: number }
export interface Match { id: number; error: number }
export interface Detection { box: Box; candidates: Match[]; lb: number | null; confident: boolean }
export interface ScanResult { detections: Detection[]; ignoredR: number }
interface Slot { box: Box; rarity: Rarity | null; needsArtworkMatch: boolean }
interface Samples { from: Uint32Array; to: Uint32Array }
interface Template extends Pixels { samples: Samples }
/** `fine` holds full-size templates by the coarse width they refine, most recently used last. */
interface PreparedReference { reference: Reference; coarse: Template[]; fine: Map<number, Template[]> }
const ARTWORK_REGION = { x: .07, y: .2, width: .86, height: .64 };
/**
 * The best coarse width differs from slot to slot even within one screenshot, so each card keeps fine templates for a
 * few of its seven coarse widths. On the test fixtures four widths saved almost every rebuild that all seven did.
 */
const FINE_WIDTHS = 4;

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

/** Grid slots fix the composition's position; allow small errors in the frame, scale and scroll offset. */
function search(image: Pixels, patch: Template, limit: number): number {
  const { from, to } = patch.samples;
  const centerX = image.width / 2 + (ARTWORK_REGION.x - .5) * patch.width / ARTWORK_REGION.width;
  const centerY = image.height / 2 + (ARTWORK_REGION.y - .5) * patch.height / ARTWORK_REGION.height;
  const marginX = image.width * .05, marginY = image.height * .06;
  const left = Math.max(0, Math.floor(centerX - marginX)), right = Math.min(image.width - patch.width, Math.ceil(centerX + marginX));
  const top = Math.max(0, Math.floor(centerY - marginY)), bottom = Math.min(image.height - patch.height, Math.ceil(centerY + marginY));
  let best = limit * from.length * 3 * 255 * 255, found = false;
  for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
    let error = 0;
    const base = (y * image.width + x) * 4;
    for (let i = 0; i < from.length; i++) {
      const p = from[i]!, q = base + to[i]!;
      error += pixelError(image.data[q]!, patch.data[p]!) + pixelError(image.data[q + 1]!, patch.data[p + 1]!) + pixelError(image.data[q + 2]!, patch.data[p + 2]!);
      if (error >= best) break;
    }
    if (error < best) { best = error; found = true; }
  }
  return found ? best / (from.length * 3 * 255 * 255) : Infinity;
}

function badges(image: Pixels, references: Reference[]): Slot[] {
  // Portrait support-card lists use five columns. Coordinates are discovered from the rarity badges;
  // width determines their scale, so both supplied phone sizes and resized screenshots use the same path.
  const scale = image.width * .17 / 128;
  const found: { box: Box; rarity: Rarity; error: number }[] = [];
  for (const rarity of ['SSR', 'SR', 'R'] as const) {
    const ref = references.find(r => r.rarity === rarity && r.image);
    if (!ref?.image) continue;
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
  const near = (a: Box, b: Box) => Math.abs(a.x - b.x) < 50 * scale && Math.abs(a.y - b.y) < 85 * scale;
  const kept: typeof found = [];
  for (const f of found.sort((a, b) => a.error - b.error)) {
    if (kept.some(k => near(k.box, f.box))) continue;
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
  for (const row of rows) {
    if (row.length === 1) {
      // A lone badge needs artwork and diamond evidence before it can establish a card.
      const badge = row[0]!;
      result.push({ box: badge.box, rarity: badge.rarity, needsArtworkMatch: true });
      continue;
    }
    const y = row.map(b => b.box.y).sort((a, b) => a - b)[Math.floor(row.length / 2)]!;
    // Where both the SR and R badge templates matched, an SR row settles it. A clear R badge stays R: the SR/R
    // boundary row of a rarity-sorted list holds real R cards beside SR cards.
    const srRow = row.filter(b => b.rarity === 'SR').length >= 3;
    const rarity = (badge: (typeof row)[number]): Rarity => srRow && badge.rarity === 'R'
      && found.some(f => f.rarity === 'SR' && near(f.box, badge.box)) ? 'SR' : badge.rarity;
    for (let column = 0; column < 5; column++) {
      const x = image.width * (.039 + column * .1895);
      const badge = row.find(b => Math.abs(b.box.x - x) < 10);
      result.push({ box: badge?.box ?? { x, y, width: 128 * scale, height: 174 * scale },
        rarity: badge ? rarity(badge) : null, needsArtworkMatch: !badge });
    }
  }
  // A scrolled first row can lose its badges while keeping the art and diamonds visible.
  const first = gridRows[0]?.[0]?.box;
  if (first) {
    const y = first.y - image.width * .254;
    if (y >= 0) for (let column = 0; column < 5; column++) {
      const x = image.width * (.039 + column * .1895);
      if (result.some(slot => Math.abs(slot.box.x - x) < 10 && Math.abs(slot.box.y - y) < 8)) continue;
      result.unshift({ box: { ...first, x, y }, rarity: null, needsArtworkMatch: true });
    }
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
  const box = { x: artwork.width * ARTWORK_REGION.x, y: artwork.height * ARTWORK_REGION.y,
    width: artwork.width * ARTWORK_REGION.width, height: artwork.height * ARTWORK_REGION.height };
  return resizeCrop(artwork, box, width, Math.round(width * box.height / box.width));
}

/** Templates belong to one loaded catalog and are reused for every screenshot in its worker. */
export function createRecognizer(references: Reference[]) {
  const samples = new Map<string, Samples>();
  function template(artwork: Pixels, width: number, tileWidth: number): Template {
    const patch = artworkPatch(artwork, width);
    const step = tileWidth === 40 ? Math.max(1, Math.floor(width / 10)) : 1;
    const key = `${patch.width}:${patch.height}:${tileWidth}:${step}`;
    let offsets = samples.get(key);
    if (!offsets) {
      const points: [number, number][] = [];
      for (let y = 1; y < patch.height - 1; y += step) for (let x = 1; x < patch.width - 1; x += step) points.push([x, y]);
      // Reach across the artwork before filling in nearby pixels, for early rejection of poor matches.
      points.sort((a, b) => ((a[0] * 13 + a[1] * 7) % 31) - ((b[0] * 13 + b[1] * 7) % 31));
      offsets = { from: Uint32Array.from(points, ([x, y]) => (y * patch.width + x) * 4),
        to: Uint32Array.from(points, ([x, y]) => (y * tileWidth + x) * 4) };
      samples.set(key, offsets);
    }
    return { ...patch, samples: offsets };
  }
  const prepared: PreparedReference[] = references.filter(ref => ref.artwork).map(reference => ({ reference,
    coarse: Array.from({ length: 7 }, (_, i) => template(reference.artwork!, 31 + i, 40)), fine: new Map(),
  }));
  return (image: Pixels, progress?: (done: number, total: number) => void): ScanResult => {
    const slots = badges(image, references);
    const detections: Detection[] = [];
    let ignoredR = 0;
    for (const [index, slot] of slots.entries()) {
      progress?.(index, slots.length);
      const tile = resizeCrop(image, slot.box, 80, 109);
      const lb = readLimitBreak(tile);
      if (slot.needsArtworkMatch && lb === null) continue;
      if (slot.rarity === 'R') { ignoredR++; continue; }
      const coarse = resizeCrop(image, slot.box, 40, 55);
      const type = cardType(tile);
      const matches: (Match & { width: number; prepared: PreparedReference })[] = [];
      for (const entry of prepared) {
        const ref = entry.reference;
        const compatibleType = !type || ref.type === type || (['pal', 'power'].includes(type) && ['pal', 'power', 'group'].includes(ref.type));
        if (!ref.artwork || (slot.rarity && ref.rarity !== slot.rarity) || !compatibleType) continue;
        let error = Infinity;
        let width = 0;
        for (const patch of entry.coarse) {
          const score = search(coarse, patch, error);
          if (score < error) { error = score; width = patch.width; }
        }
        matches.push({ id: ref.id, error, width, prepared: entry });
      }
      matches.sort((a, b) => a.error - b.error);
      const candidates = matches.slice(0, 4).map(match => {
        const { fine, reference } = match.prepared;
        let patches = fine.get(match.width);
        if (patches) fine.delete(match.width);
        else {
          patches = [-1, 0, 1].map(offset => template(reference.artwork!, match.width * 2 + offset, 80));
          if (fine.size >= FINE_WIDTHS) fine.delete(fine.keys().next().value!);
        }
        fine.set(match.width, patches);
        let error = Infinity;
        for (const patch of patches) error = Math.min(error, search(tile, patch, error));
        return { id: match.id, error };
      }).sort((a, b) => a.error - b.error);
      const first = candidates[0], second = candidates[1];
      const confident = !!first && first.error < .018 && (!second || first.error < second.error * .6);
      if (slot.needsArtworkMatch && (!confident || first!.error > .012)) continue;
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
  };
}

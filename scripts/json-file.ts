import fs from 'node:fs/promises';

export const exists = (file: string) => fs.access(file).then(() => true, () => false);
export const readJson = async (file: string) => JSON.parse(await fs.readFile(file, 'utf8'));

/** Writes through a temporary file, so an interrupted run leaves the previous file whole. */
export async function writeFileAtomic(file: string, data: string | Uint8Array) {
  await fs.writeFile(`${file}.tmp`, data);
  await fs.rename(`${file}.tmp`, file);
}
export const writeJson = (file: string, value: unknown) => writeFileAtomic(file, JSON.stringify(value, null, 1) + '\n');

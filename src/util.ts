import type { N } from "./types";

export const CATS: Record<string, { label: string; color: string; ink: string; exts: string }> = {
  video: { label: "Video", color: "#ef5b6b", ink: "#0b0e12", exts: "mp4 mkv avi mov wmv flv webm m4v mpg mpeg vob m2ts" },
  archives: { label: "Archive", color: "#f2b84b", ink: "#0b0e12", exts: "zip rar 7z tar gz bz2 xz iso img vhd vhdx vmdk cab wim bak" },
  images: { label: "Image", color: "#4fd1a5", ink: "#0b0e12", exts: "jpg jpeg png gif bmp webp tif tiff heic raw cr2 nef psd svg ico dng" },
  documents: { label: "Docs", color: "#5b9df2", ink: "#0b0e12", exts: "pdf doc docx xls xlsx ppt pptx txt md rtf odt csv epub" },
  code: { label: "Code", color: "#a78bfa", ink: "#0b0e12", exts: "js ts jsx tsx json html css rs py c cpp h java cs go rb php sql xml yml yaml toml db sqlite log map o obj pdb rlib lib" },
  apps: { label: "App", color: "#8aa0bd", ink: "#0b0e12", exts: "exe dll sys msi msix dat bin so node pak mui cat" },
  audio: { label: "Audio", color: "#f2864b", ink: "#0b0e12", exts: "mp3 flac wav aac ogg m4a wma opus aiff" },
  other: { label: "Other", color: "#3b4656", ink: "#c3ccd9", exts: "" },
};const extCat = new Map<string, string>();
for (const [k, v] of Object.entries(CATS)) for (const e of v.exts.split(" ")) if (e) extCat.set(e, k);

export const extOf = (name: string) => {
  const i = name.lastIndexOf(".");
  return i > 0 && i < name.length - 1 ? name.slice(i + 1).toLowerCase() : "";
};
export const catOfExt = (e: string) => extCat.get(e) ?? "other";
export const catOf = (n: N) => (n.k === 1 ? catOfExt(extOf(n.n)) : n.k === 2 ? "other" : "");

export const fmt = (b: number) => {
  if (b < 1024) return `${b} B`;
  const u = ["KB", "MB", "GB", "TB", "PB"];
  let v = b / 1024, i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)} ${u[i]}`;
};
export const pct = (a: number, b: number) => (b > 0 ? ((a / b) * 100).toFixed(a / b < 0.1 ? 1 : 0) + "%" : "0%");

export const pathOf = (n: N): string => {
  const parts: string[] = [];
  for (let c: N | undefined = n; c; c = c.p) parts.push(c.n);
  parts.reverse();
  let out = parts[0];
  for (let i = 1; i < parts.length; i++) out += (out.endsWith("\\") ? "" : "\\") + parts[i];
  return out;
};

const UNITS: Record<string, number> = { b: 1, k: 1024, kb: 1024, m: 1024 ** 2, mb: 1024 ** 2, g: 1024 ** 3, gb: 1024 ** 3, t: 1024 ** 4, tb: 1024 ** 4 };
/** "20gb", "1.5 TB", "500m", "20" (GB) -> bytes, or null */
export function parseSize(s: string): number | null {
  const m = /^\s*(\d+(?:\.\d+)?)\s*([a-z]*)\s*$/i.exec(s);
  if (!m) return null;
  const unit = UNITS[(m[2] || "gb").toLowerCase()];
  return unit ? Math.round(parseFloat(m[1]) * unit) : null;
}

export const inSubtree = (n: N, root: N | null) => {
  for (let c: N | undefined = n; c; c = c.p) if (c === root) return true;
  return false;
};

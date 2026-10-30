import type { Item, N, Plan, Risk } from "./types";
import { catOfExt, extOf, pathOf } from "./util";

const MB = 1024 * 1024;

/** Disposable or regenerating folders. First match wins. */
const SAFE_DIRS: [RegExp, string][] = [
  [/\\\$recycle\.bin$/, "Recycle Bin"],
  [/\\windows\\softwaredistribution\\download$/, "Update cache"],
  [/\\(temp|tmp)$/, "Temp files"],
  [/\\(cache|caches|code cache|gpucache|shadercache|cache2|dawncache|grshadercache|inetcache)$/, "App cache"],
  [/\\\.cache$/, "Cache"],
  [/\\(crashdumps|minidump)$/, "Crash dumps"],
  [/\\node_modules$/, "npm packages"],
  [/\\__pycache__$/, "Python cache"],
  [/\\(npm-cache|_cacache|\.gradle\\caches|pip\\cache|yarn\\cache)$/, "Package cache"],
  [/\\steamapps\\downloading$/, "Partial downloads"],
];
/** Worth a look, not blindly disposable. */
const REVIEW_DIRS: [RegExp, string][] = [
  [/^[a-z]:\\windows\.old$/, "Old Windows (use Disk Cleanup)"],
  [/\\programdata\\package cache$/, "Installer cache"],
  [/\\\.nuget\\packages$/, "NuGet packages"],
];
const PROTECTED = [/^[a-z]:\\windows(\\|$)/, /\\program files( \(x86\))?(\\|$)/, /\\system volume information(\\|$)/, /^[a-z]:\\recovery(\\|$)/, /\\\$winreagent(\\|$)/];
const PROTECTED_EXCEPTIONS = /^[a-z]:\\windows\\(temp|softwaredistribution\\download)$/;

/** Folders whose direct children are whole game installs. */
const GAME_LIBS: [RegExp, string][] = [
  [/\\steamapps\\common$/, "Steam"],
  [/\\epic games$/, "Epic"],
  [/\\gog galaxy\\games$|\\gog games$/, "GOG"],
  [/\\xboxgames$/, "Xbox"],
  [/\\riot games$/, "Riot"],
  [/\\ubisoft game launcher\\games$/, "Ubisoft"],
  [/\\(ea games|origin games)$/, "EA"],
  [/^[a-z]:\\games$/, "Game"],
];
/** Launcher territory is eligible even under Program Files. */
const GAME_ZONE = /\\(steamapps|epic games|gog galaxy|gog games|xboxgames|riot games|ubisoft game launcher|ea games|origin games)(\\|$)/;
/** Folders that hold unrelated things; never offered as one unit. */
const CONTAINERS = new Set(["downloads", "documents", "desktop", "videos", "pictures", "music", "users", "appdata", "local", "roaming", "temp", "common"]);

const SAFE_EXT = new Set(["tmp", "dmp", "etl"]);
const FILE_WHY: Record<string, string> = {
  video: "Video", audio: "Audio", archives: "Archive", images: "Image", documents: "Document", code: "Data file", apps: "Binary", other: "Large file",
};
const VM_EXT = new Set(["vhd", "vhdx", "vmdk", "iso", "wim"]);
const NEVER = new Set(["pagefile.sys", "swapfile.sys"]);

/** Everything that could be cleared, as whole units (files, caches, game folders). */
function collect(root: N, target: number): Item[] {
  const fileMin = Math.max(32 * MB, Math.floor(target / 400));
  const dirMin = 20 * MB;
  const found: Item[] = [];
  const add = (node: N, risk: Risk, why: string, unit?: Item["unit"]) => found.push({ node, path: pathOf(node), size: node.s, risk, why, unit });

  const walk = (d: N, p: string, prot: boolean) => {
    const lib = GAME_LIBS.find(([r]) => r.test(p));
    if (lib) {
      for (const c of d.c ?? []) if (c.k === 0 && c.s >= dirMin) add(c, "review", `${lib[1]} game`, "game");
      return;
    }
    let isProt = (prot || PROTECTED.some((r) => r.test(p))) && !GAME_ZONE.test(p);
    const exception = PROTECTED_EXCEPTIONS.test(p);
    if (!isProt || exception) {
      const safe = SAFE_DIRS.find(([r]) => r.test(p));
      if (safe && d.s >= dirMin) { add(d, "safe", safe[1]); return; }
    }
    if (!isProt) {
      const rev = REVIEW_DIRS.find(([r]) => r.test(p));
      if (rev && d.s >= dirMin) { add(d, "review", rev[1]); return; }
    }
    if (exception) isProt = false;
    for (const c of d.c ?? []) {
      if (c.k === 0) walk(c, p + (p.endsWith("\\") ? "" : "\\") + c.n.toLowerCase(), isProt);
      else if (c.k === 1 && c.s >= fileMin && !isProt) {
        const lname = c.n.toLowerCase();
        if (NEVER.has(lname)) continue;
        const ext = extOf(lname);
        if (lname === "hiberfil.sys") add(c, "review", "Hibernation file");
        else if (SAFE_EXT.has(ext)) add(c, "safe", "Temp file");
        else if (ext === "log") add(c, "safe", "Log");
        else if (VM_EXT.has(ext)) add(c, "review", "Disk image");
        else if (ext === "exe" || ext === "msi") add(c, "review", "Installer");
        else add(c, "review", FILE_WHY[catOfExt(ext)]);
      }
    }
  };
  walk(root, root.n.toLowerCase().replace(/[\\/]+$/, "") || root.n.toLowerCase(), false);

  // files that make up most of one folder become that folder
  const byParent = new Map<N, Item[]>();
  for (const it of found) {
    if (it.node.k !== 1 || !it.node.p) continue;
    const l = byParent.get(it.node.p);
    l ? l.push(it) : byParent.set(it.node.p, [it]);
  }
  const rolled = new Set<Item>();
  for (const [dir, list] of byParent) {
    const sum = list.reduce((a, i) => a + i.size, 0);
    if (list.length < 2 || sum < dir.s * 0.6 || !dir.p || CONTAINERS.has(dir.n.toLowerCase())) continue;
    list.forEach((i) => rolled.add(i));
    found.push({
      node: dir, path: pathOf(dir), size: dir.s, unit: "folder",
      risk: list.every((i) => i.risk === "safe") ? "safe" : "review",
      why: `Folder, ${list.length} files = ${Math.round((sum / dir.s) * 100)}%`,
    });
  }
  return found.filter((i) => !rolled.has(i)).sort((a, b) => b.size - a.size);
}

const sum = (l: Item[]) => l.reduce((a, i) => a + i.size, 0);

/** Best set of exactly k items (from ascending `a`) whose total is the smallest one >= target. */
function bestK(a: Item[], target: number, k: 1 | 2 | 3): Item[] | null {
  const n = a.length;
  if (k === 1) return a.find((i) => i.size >= target) ? [a.find((i) => i.size >= target)!] : null;
  let best: Item[] | null = null, bestSum = Infinity;
  const pair = (from: number, need: number, head?: Item) => {
    let lo = from, hi = n - 1;
    while (lo < hi) {
      const s = a[lo].size + a[hi].size;
      if (s >= need) {
        const total = s + (head?.size ?? 0);
        if (total < bestSum) { bestSum = total; best = head ? [head, a[lo], a[hi]] : [a[lo], a[hi]]; }
        hi--;
      } else lo++;
    }
  };
  if (k === 2) pair(0, target);
  else for (let i = 0; i < n - 2; i++) pair(i + 1, target - a[i].size, a[i]);
  return best;
}

/** Greedy cover, then trimmed and swapped to overshoot as little as possible. */
function tight(pool: Item[], target: number): Item[] | null {
  const desc = [...pool].sort((x, y) => y.size - x.size);
  const pick: Item[] = [];
  let s = 0;
  for (const it of desc) { if (s >= target) break; pick.push(it); s += it.size; }
  if (s < target) return null;
  pick.sort((x, y) => x.size - y.size);
  while (pick.length > 1 && s - pick[0].size >= target) s -= pick.shift()!.size;
  const used = new Set(pick);
  const rest = desc.filter((i) => !used.has(i)).reverse(); // ascending
  for (let i = 0; i < pick.length; i++) {
    const need = target - (s - pick[i].size);
    const j = rest.findIndex((r) => r.size >= need && r.size < pick[i].size);
    if (j >= 0) { s += rest[j].size - pick[i].size; [pick[i], rest[j]] = [rest[j], pick[i]]; rest.sort((x, y) => x.size - y.size); }
  }
  // an exact 1-3 item combination can land closer than the greedy cover
  const asc2 = [...pool].sort((x, y) => x.size - y.size);
  let best = pick;
  for (const k of [1, 2, 3] as const) {
    const r = bestK(asc2, target, k);
    if (r && sum(r) < sum(best)) best = r;
  }
  return best;
}

export function buildPlans(root: N, target: number): Plan[] {
  const all = collect(root, target);
  const pool = all.slice(0, 400);
  const asc = [...pool].reverse();
  const out: Plan[] = [];
  const seen = new Set<string>();
  const push = (id: string, name: string, items: Item[] | null) => {
    if (!items?.length) return;
    const key = items.map((i) => i.path).sort().join("|");
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ id, name, items: [...items].sort((a, b) => b.size - a.size), total: sum(items) });
  };

  // fewest items that land closest above the target
  let pick: Item[] | null = null, fallback: Item[] | null = null;
  for (const k of [1, 2, 3] as const) {
    const r = bestK(asc, target, k);
    if (!r) continue;
    const over = (sum(r) - target) / target;
    if (over <= 0.3) { pick = r; break; }
    if (!fallback || sum(r) < sum(fallback)) fallback = r;
  }
  push("fewest", "Fewest", pick ?? fallback);

  const safe = pool.filter((i) => i.risk === "safe");
  push("safe", "Safe", tight(safe, target));

  const small = pool.filter((i) => i.node.k === 0 && i.risk === "review" && i.size <= target / 2);
  push("apps", "Apps", tight(small, target));

  // safe first, topped up from the rest
  const safeSum = sum(safe);
  if (safeSum < target) {
    const top = tight(pool.filter((i) => i.risk === "review"), target - safeSum);
    if (top) push("mix", "Mix", [...safe, ...top]);
  }

  if (!out.length) push("max", "All", all);
  return out;
}

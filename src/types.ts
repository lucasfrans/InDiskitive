export interface N { n: string; s: number; f: number; k: number; c?: N[]; p?: N }
export interface Drive { mount: string; name: string; total: number; free: number }
export interface ExtStat { e: string; b: number; c: number }
export interface ScanResult {
  root: N; exts: ExtStat[]; elapsedMs: number; files: number; dirs: number; bytes: number;
  mode: "mft" | "walk"; fallback?: string;
}
export interface Data { root: N; exts: ExtStat[]; meta: string; path: string }

export type Risk = "safe" | "review";
export interface Item { node: N; path: string; size: number; risk: Risk; why: string; unit?: "game" | "folder" }
/** One way to free the target: a small set of items that just clears it. */
export interface Plan { id: string; name: string; items: Item[]; total: number }
export interface Quota { target: number; plans: Plan[]; active: string; checked: Record<string, Set<N>> }

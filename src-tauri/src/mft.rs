//! Fast NTFS scanner: reads the Master File Table straight off the volume.
//! Needs an elevated process (raw volume access). Any failure is reported to the
//! caller, which falls back to the regular directory walk.

use crate::{Ctx, Node, KEEP_FILES};
use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io;
use std::os::windows::fs::FileExt;
use std::sync::atomic::Ordering::Relaxed;
use std::sync::mpsc::sync_channel;

const CHUNK: usize = 8 * 1024 * 1024;
const ROOT: usize = 5;
const FIRST_USER_RECORD: usize = 24;

const F_USED: u8 = 1;
const F_DIR: u8 = 2;
const F_REPARSE: u8 = 4;
const F_NAME: u8 = 8;

#[derive(Clone, Copy, Default)]
struct Ent {
    parent: u32,
    size: u64,
    name_off: u32,
    name_len: u16,
    flags: u8,
    ns: u8,
}

fn le16(b: &[u8], o: usize) -> u16 {
    u16::from_le_bytes([b[o], b[o + 1]])
}
fn le32(b: &[u8], o: usize) -> u32 {
    u32::from_le_bytes(b[o..o + 4].try_into().unwrap())
}
fn le64(b: &[u8], o: usize) -> u64 {
    u64::from_le_bytes(b[o..o + 8].try_into().unwrap())
}

fn read_exact_at(f: &File, mut buf: &mut [u8], mut off: u64) -> io::Result<()> {
    while !buf.is_empty() {
        let n = f.seek_read(buf, off)?;
        if n == 0 {
            return Err(io::ErrorKind::UnexpectedEof.into());
        }
        off += n as u64;
        buf = &mut buf[n..];
    }
    Ok(())
}

/// Undo the NTFS update-sequence protection on a file record. False if the record is invalid.
fn fixup(rec: &mut [u8]) -> bool {
    if rec.len() < 48 || &rec[0..4] != b"FILE" {
        return false;
    }
    let uo = le16(rec, 4) as usize;
    let uc = le16(rec, 6) as usize;
    if uc < 2 || uo + uc * 2 > rec.len() {
        return false;
    }
    let usn = [rec[uo], rec[uo + 1]];
    for i in 1..uc {
        let end = i * 512;
        if end > rec.len() {
            break;
        }
        if rec[end - 2..end] != usn {
            return false;
        }
        rec[end - 2] = rec[uo + i * 2];
        rec[end - 1] = rec[uo + i * 2 + 1];
    }
    true
}

/// Calls `f(type, attribute_bytes)` for every attribute in a record.
fn for_attrs(rec: &[u8], mut f: impl FnMut(u32, &[u8])) {
    let used = (le32(rec, 0x18) as usize).min(rec.len());
    let mut p = le16(rec, 0x14) as usize;
    while p + 16 <= used {
        let ty = le32(rec, p);
        if ty == 0xFFFF_FFFF {
            break;
        }
        let len = le32(rec, p + 4) as usize;
        if len < 16 || p + len > used {
            break;
        }
        f(ty, &rec[p..p + len]);
        p += len;
    }
}

fn parse_record(rec: &[u8], idx: usize, ents: &mut [Ent], arena: &mut Vec<u16>, ext: &mut Vec<(usize, u64)>) {
    let rflags = le16(rec, 0x16);
    if rflags & 1 == 0 {
        return;
    }
    let base = (le64(rec, 0x20) & 0xFFFF_FFFF_FFFF) as usize;
    let is_ext = base != 0;

    for_attrs(rec, |ty, a| match ty {
        // $FILE_NAME (always resident)
        0x30 if !is_ext && a[8] == 0 => {
            let co = le16(a, 0x14) as usize;
            if co + 0x42 > a.len() {
                return;
            }
            let c = &a[co..];
            let nl = c[0x40] as usize;
            let ns = c[0x41];
            if 0x42 + nl * 2 > c.len() {
                return;
            }
            let e = &mut ents[idx];
            if e.flags & F_NAME == 0 || (e.ns == 2 && ns != 2) {
                e.parent = (le64(c, 0) & 0xFFFF_FFFF_FFFF) as u32;
                e.name_off = arena.len() as u32;
                e.name_len = nl as u16;
                e.ns = ns;
                for i in 0..nl {
                    arena.push(le16(c, 0x42 + i * 2));
                }
                let rp = if le32(c, 0x38) & 0x400 != 0 { F_REPARSE } else { 0 };
                e.flags = (e.flags & !F_REPARSE) | F_NAME | rp;
            }
        }
        // unnamed $DATA
        0x80 if a[9] == 0 => {
            let size = if a[8] == 0 {
                le32(a, 0x10) as u64
            } else {
                if le64(a, 0x10) != 0 {
                    return;
                }
                le64(a, 0x30)
            };
            if is_ext {
                ext.push((base, size));
            } else {
                ents[idx].size = size;
            }
        }
        _ => {}
    });

    if !is_ext {
        ents[idx].flags |= F_USED | if rflags & 2 != 0 { F_DIR } else { 0 };
    }
}

/// Data runs of the unnamed $DATA attribute of record 0 ($MFT): (start lcn, cluster count) + real size.
fn mft_extents(rec: &[u8]) -> Option<(Vec<(u64, u64)>, u64)> {
    let mut out = None;
    for_attrs(rec, |ty, a| {
        if ty != 0x80 || a[8] == 0 || a[9] != 0 || le64(a, 0x10) != 0 {
            return;
        }
        let real = le64(a, 0x30);
        let mut p = le16(a, 0x20) as usize;
        let mut lcn = 0i64;
        let mut runs = Vec::new();
        while p < a.len() && a[p] != 0 {
            let h = a[p];
            let (ln, on) = ((h & 0xF) as usize, (h >> 4) as usize);
            p += 1;
            if ln == 0 || ln > 8 || on == 0 || on > 8 || p + ln + on > a.len() {
                return;
            }
            let mut len = 0u64;
            for i in 0..ln {
                len |= (a[p + i] as u64) << (8 * i);
            }
            p += ln;
            let mut off = 0i64;
            for i in 0..on {
                off |= (a[p + i] as i64) << (8 * i);
            }
            if a[p + on - 1] & 0x80 != 0 && on < 8 {
                off |= -1i64 << (8 * on);
            }
            p += on;
            lcn += off;
            runs.push((lcn as u64, len));
        }
        out = Some((runs, real));
    });
    out
}

struct Graph {
    ents: Vec<Ent>,
    arena: Vec<u16>,
    start: Vec<u32>,
    kids: Vec<u32>,
}

impl Graph {
    fn name(&self, i: usize) -> String {
        let e = &self.ents[i];
        String::from_utf16_lossy(&self.arena[e.name_off as usize..e.name_off as usize + e.name_len as usize])
    }

    fn children(&self, i: usize) -> &[u32] {
        &self.kids[self.start[i] as usize..self.start[i + 1] as usize]
    }
}

struct Totals {
    files: u64,
    dirs: u64,
    bytes: u64,
    exts: HashMap<String, (u64, u64)>,
}

fn build(i: usize, name: String, g: &Graph, t: &mut Totals, depth: u32) -> Node {
    let mut node = Node { n: name, ..Default::default() };
    t.dirs += 1;
    let mut files: Vec<(usize, u64)> = Vec::new();
    let mut dirs: Vec<usize> = Vec::new();
    for &k in g.children(i) {
        let k = k as usize;
        if g.ents[k].flags & F_DIR != 0 {
            dirs.push(k);
        } else {
            files.push((k, g.ents[k].size));
        }
    }

    for &(k, size) in &files {
        let e = &g.ents[k];
        let nm = &g.arena[e.name_off as usize..e.name_off as usize + e.name_len as usize];
        let ext = match nm.iter().rposition(|&c| c == b'.' as u16) {
            Some(p) if p + 1 < nm.len() => String::from_utf16_lossy(&nm[p + 1..]).to_ascii_lowercase(),
            _ => String::new(),
        };
        let s = t.exts.entry(ext).or_insert((0, 0));
        s.0 += size;
        s.1 += 1;
        node.s += size;
        t.bytes += size;
    }
    t.files += files.len() as u64;
    node.f = files.len() as u64;

    if files.len() > KEEP_FILES {
        files.select_nth_unstable_by(KEEP_FILES, |a, b| b.1.cmp(&a.1));
        let rest = files.split_off(KEEP_FILES);
        let rest_s: u64 = rest.iter().map(|f| f.1).sum();
        node.c.push(Node { n: "Small files".into(), s: rest_s, f: rest.len() as u64, k: 2, c: vec![] });
    }
    for (k, s) in files {
        node.c.push(Node { n: g.name(k), s, f: 1, k: 1, c: vec![] });
    }

    if depth < 2048 {
        for k in dirs {
            let child = build(k, g.name(k), g, t, depth + 1);
            node.s += child.s;
            node.f += child.f;
            node.c.push(child);
        }
    }
    node
}

fn drive_letter(path: &str) -> Option<char> {
    let b = path.as_bytes();
    (b.len() >= 2 && b[1] == b':' && b[0].is_ascii_alphabetic()).then(|| b[0] as char)
}

pub fn scan(path: &str, ctx: &Ctx) -> Result<Node, String> {
    let letter = drive_letter(path).ok_or("not a drive path")?;
    let vol = format!(r"\\.\{}:", letter.to_ascii_uppercase());
    let f = OpenOptions::new().read(true).open(&vol).map_err(|e| format!("open {vol}: {e}"))?;

    let mut boot = [0u8; 512];
    read_exact_at(&f, &mut boot, 0).map_err(|e| e.to_string())?;
    if &boot[3..11] != b"NTFS    " {
        return Err("not an NTFS volume".into());
    }
    let bps = le16(&boot, 0x0B) as u64;
    let cluster = bps * boot[0x0D] as u64;
    let mft_lcn = le64(&boot, 0x30);
    let c = boot[0x40] as i8;
    let rec_size = if c > 0 { c as u64 * cluster } else { 1u64 << (-(c as i32)) } as usize;
    if bps == 0 || cluster == 0 || !(256..=65536).contains(&rec_size) {
        return Err("unexpected NTFS geometry".into());
    }

    // Record 0 describes where the rest of the MFT lives.
    let mut buf0 = vec![0u8; (rec_size as u64).max(bps) as usize];
    read_exact_at(&f, &mut buf0, mft_lcn * cluster).map_err(|e| e.to_string())?;
    let rec0 = &mut buf0[..rec_size];
    if !fixup(rec0) {
        return Err("$MFT record 0 is invalid".into());
    }
    let (extents, real) = mft_extents(rec0).ok_or("could not read $MFT data runs")?;
    let nrec = (real as usize) / rec_size;
    if nrec == 0 || nrec > 200_000_000 {
        return Err("implausible MFT size".into());
    }
    if extents.iter().any(|&(_, len)| (len * cluster) % rec_size as u64 != 0) {
        return Err("MFT extent not record aligned".into());
    }

    let mut ents = vec![Ent::default(); nrec];
    let mut arena: Vec<u16> = Vec::with_capacity(nrec * 12);
    let mut ext: Vec<(usize, u64)> = Vec::new();
    let round_up = |n: usize| ((n as u64 + bps - 1) / bps * bps) as usize;

    let (tx, rx) = sync_channel::<(usize, Vec<u8>)>(3);
    let read_result: io::Result<()> = std::thread::scope(|s| {
        // `move` hands the sender to the reader so the channel closes when it finishes;
        // otherwise the parse loop below would wait forever for more chunks.
        let (f, extents) = (&f, &extents);
        let reader = s.spawn(move || -> io::Result<()> {
            let mut next_rec = 0usize;
            let mut data_left = real;
            for &(lcn, len) in extents {
                let mut off = lcn * cluster;
                let mut ext_left = len * cluster;
                while ext_left > 0 && data_left > 0 {
                    if ctx.cancel.load(Relaxed) {
                        return Ok(());
                    }
                    let n = (CHUNK as u64).min(ext_left).min(data_left) as usize;
                    let mut buf = vec![0u8; round_up(n)];
                    read_exact_at(&f, &mut buf, off)?;
                    buf.truncate(n);
                    if tx.send((next_rec, buf)).is_err() {
                        return Ok(());
                    }
                    next_rec += n / rec_size;
                    off += n as u64;
                    ext_left -= n as u64;
                    data_left -= n as u64;
                }
            }
            Ok(())
        });

        for (start, mut buf) in rx.iter() {
            for (i, rec) in buf.chunks_exact_mut(rec_size).enumerate() {
                let idx = start + i;
                if idx >= nrec {
                    break;
                }
                if fixup(rec) {
                    parse_record(rec, idx, &mut ents, &mut arena, &mut ext);
                    if ents[idx].flags & F_DIR == 0 {
                        ctx.bytes.fetch_add(ents[idx].size, Relaxed);
                    }
                }
            }
            ctx.files.fetch_add((buf.len() / rec_size) as u64, Relaxed);
            if ctx.cancel.load(Relaxed) {
                break;
            }
        }
        drop(rx);
        reader.join().unwrap_or_else(|_| Err(io::Error::other("reader thread panicked")))
    });
    read_result.map_err(|e| e.to_string())?;
    if ctx.cancel.load(Relaxed) {
        return Err("cancelled".into());
    }

    // Sizes that live in extension records (heavily fragmented files).
    for (b, size) in ext {
        if b < nrec && ents[b].size == 0 {
            ents[b].size = size;
        }
    }

    // children lists in compressed-row form
    let valid = |i: usize, e: &Ent| {
        e.flags & F_USED != 0 && e.flags & F_NAME != 0 && e.flags & F_REPARSE == 0 && i >= FIRST_USER_RECORD && (e.parent as usize) < nrec
    };
    let mut start = vec![0u32; nrec + 2];
    for (i, e) in ents.iter().enumerate() {
        if valid(i, e) {
            start[e.parent as usize + 1] += 1;
        }
    }
    for i in 0..=nrec {
        start[i + 1] += start[i];
    }
    let mut cursor = start.clone();
    let mut kids = vec![0u32; start[nrec] as usize];
    for (i, e) in ents.iter().enumerate() {
        if valid(i, e) {
            let c = &mut cursor[e.parent as usize];
            kids[*c as usize] = i as u32;
            *c += 1;
        }
    }
    let g = Graph { ents, arena, start, kids };
    if g.ents[ROOT].flags & F_DIR == 0 {
        return Err("volume root not found".into());
    }

    // Locate the requested folder inside the volume.
    let mut cur = ROOT;
    for comp in path[2..].split(['\\', '/']).filter(|c| !c.is_empty()) {
        let want = comp.to_lowercase();
        cur = g
            .children(cur)
            .iter()
            .map(|&k| k as usize)
            .find(|&k| g.ents[k].flags & F_DIR != 0 && g.name(k).to_lowercase() == want)
            .ok_or_else(|| format!("folder not found in MFT: {comp}"))?;
    }

    let mut t = Totals { files: 0, dirs: 0, bytes: 0, exts: HashMap::new() };
    let root = build(cur, path.to_string(), &g, &mut t, 0);
    ctx.files.store(t.files, Relaxed);
    ctx.dirs.store(t.dirs, Relaxed);
    ctx.bytes.store(t.bytes, Relaxed);
    let mut m = ctx.exts.lock().unwrap();
    for (k, (b, c)) in t.exts {
        let s = m.entry(k).or_insert((0, 0));
        s.0 += b;
        s.1 += c;
    }
    Ok(root)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Builds a minimal 1024-byte file record with a $FILE_NAME and a resident $DATA.
    fn record(name: &str, parent: u64, is_dir: bool, data_len: u32) -> Vec<u8> {
        let mut r = vec![0u8; 1024];
        r[0..4].copy_from_slice(b"FILE");
        r[4..6].copy_from_slice(&0x30u16.to_le_bytes()); // usa offset
        r[6..8].copy_from_slice(&3u16.to_le_bytes()); // usn + 2 sectors
        r[0x14..0x16].copy_from_slice(&0x38u16.to_le_bytes());
        r[0x16..0x18].copy_from_slice(&(1u16 | if is_dir { 2 } else { 0 }).to_le_bytes());
        let mut p = 0x38;
        // $FILE_NAME
        let nl = name.encode_utf16().count();
        let clen = 0x42 + nl * 2;
        let alen = (0x18 + clen + 7) / 8 * 8;
        r[p..p + 4].copy_from_slice(&0x30u32.to_le_bytes());
        r[p + 4..p + 8].copy_from_slice(&(alen as u32).to_le_bytes());
        r[p + 0x10..p + 0x14].copy_from_slice(&(clen as u32).to_le_bytes());
        r[p + 0x14..p + 0x16].copy_from_slice(&0x18u16.to_le_bytes());
        let c = p + 0x18;
        r[c..c + 8].copy_from_slice(&parent.to_le_bytes());
        r[c + 0x40] = nl as u8;
        r[c + 0x41] = 1;
        for (i, u) in name.encode_utf16().enumerate() {
            r[c + 0x42 + i * 2..c + 0x44 + i * 2].copy_from_slice(&u.to_le_bytes());
        }
        p += alen;
        // $DATA (resident, unnamed)
        r[p..p + 4].copy_from_slice(&0x80u32.to_le_bytes());
        r[p + 4..p + 8].copy_from_slice(&0x18u32.to_le_bytes());
        r[p + 0x10..p + 0x14].copy_from_slice(&data_len.to_le_bytes());
        p += 0x18;
        r[p..p + 4].copy_from_slice(&0xFFFF_FFFFu32.to_le_bytes());
        let used = (p + 8) as u32;
        r[0x18..0x1C].copy_from_slice(&used.to_le_bytes());
        // fixups: usn = 0xAAAA, save real sector tails (zeros) in the array
        r[0x30] = 0xAA;
        r[0x31] = 0xAA;
        r[510] = 0xAA;
        r[511] = 0xAA;
        r[1022] = 0xAA;
        r[1023] = 0xAA;
        r
    }

    #[test]
    fn parses_names_sizes_and_tree() {
        let mut ents = vec![Ent::default(); 32];
        let mut arena = Vec::new();
        let mut ext = Vec::new();
        let mut recs = vec![(5usize, record(".", 5, true, 0)), (24, record("docs", 5, true, 0)), (25, record("a.txt", 24, false, 1234))];
        for (i, r) in recs.iter_mut() {
            assert!(fixup(r));
            parse_record(r, *i, &mut ents, &mut arena, &mut ext);
        }
        assert_eq!(ents[25].size, 1234);
        assert_eq!(ents[25].parent, 24);
        assert!(ents[24].flags & F_DIR != 0);

        let mut start = vec![0u32; 34];
        start[6] = 1; // dummy; build via real path below
        let g = Graph { ents: ents.clone(), arena, start: vec![0; 34], kids: vec![] };
        assert_eq!(g.name(25), "a.txt");
    }

    #[test]
    fn fixup_rejects_torn_record() {
        let mut r = record("x", 5, false, 1);
        r[510] = 0x11;
        assert!(!fixup(&mut r));
    }

    #[test]
    fn decodes_data_runs() {
        // $DATA non-resident: runs at 0x40: len=0x10 clusters @ lcn 0x100, then len=8 @ -0x20 relative
        let mut a = vec![0u8; 0x58];
        a[0..4].copy_from_slice(&0x80u32.to_le_bytes());
        a[4..8].copy_from_slice(&0x58u32.to_le_bytes());
        a[8] = 1;
        a[0x20..0x22].copy_from_slice(&0x40u16.to_le_bytes());
        a[0x30..0x38].copy_from_slice(&0x9000u64.to_le_bytes());
        a[0x40..0x46].copy_from_slice(&[0x21, 0x10, 0x00, 0x01, 0x11, 0x08]);
        a[0x46] = 0xE0; // relative offset -0x20
        a[0x47] = 0;
        let mut rec = vec![0u8; 1024];
        rec[0x14..0x16].copy_from_slice(&0x38u16.to_le_bytes());
        rec[0x38..0x38 + a.len()].copy_from_slice(&a);
        let end = 0x38 + a.len();
        rec[end..end + 4].copy_from_slice(&0xFFFF_FFFFu32.to_le_bytes());
        rec[0x18..0x1C].copy_from_slice(&((end + 8) as u32).to_le_bytes());
        let (runs, real) = mft_extents(&rec).unwrap();
        assert_eq!(real, 0x9000);
        assert_eq!(runs, vec![(0x100, 0x10), (0xE0, 8)]);
    }
}

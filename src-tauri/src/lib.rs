use rayon::prelude::*;
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering::Relaxed};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};

#[cfg(windows)]
mod mft;

/// Files kept individually per directory; the rest collapse into one "Small files" node.
pub(crate) const KEEP_FILES: usize = 48;

#[derive(Serialize, Default)]
pub(crate) struct Node {
    /// name
    pub(crate) n: String,
    /// size in bytes
    pub(crate) s: u64,
    /// file count
    pub(crate) f: u64,
    /// 0 = directory, 1 = file, 2 = collapsed small items
    pub(crate) k: u8,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub(crate) c: Vec<Node>,
}

#[derive(Serialize)]
struct ExtStat {
    e: String,
    b: u64,
    c: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanResult {
    root: Node,
    exts: Vec<ExtStat>,
    elapsed_ms: u64,
    files: u64,
    dirs: u64,
    bytes: u64,
    /// "mft" (raw NTFS read) or "walk" (directory walk)
    mode: &'static str,
    /// why the MFT fast path was skipped, if it was attempted
    fallback: Option<String>,
}

#[derive(Serialize, Clone)]
struct Progress {
    files: u64,
    dirs: u64,
    bytes: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Drive {
    mount: String,
    name: String,
    total: u64,
    free: u64,
}

pub(crate) struct Ctx {
    pub(crate) cancel: Arc<AtomicBool>,
    pub(crate) files: AtomicU64,
    pub(crate) dirs: AtomicU64,
    pub(crate) bytes: AtomicU64,
    pub(crate) exts: Mutex<HashMap<String, (u64, u64)>>,
}

#[derive(Default)]
struct ScanState {
    cancel: Arc<AtomicBool>,
}

#[cfg(windows)]
fn is_reparse(md: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    md.file_attributes() & 0x400 != 0
}

#[cfg(not(windows))]
fn is_reparse(_: &fs::Metadata) -> bool {
    false
}

fn walk(dir: &Path, name: String, ctx: &Ctx) -> Node {
    let mut node = Node { n: name, ..Default::default() };
    if ctx.cancel.load(Relaxed) {
        return node;
    }
    ctx.dirs.fetch_add(1, Relaxed);
    let Ok(rd) = fs::read_dir(dir) else { return node };

    let mut subdirs: Vec<(PathBuf, String)> = Vec::new();
    let mut files: Vec<(String, u64)> = Vec::new();
    let mut local: HashMap<String, (u64, u64)> = HashMap::new();
    let mut bytes = 0u64;

    for e in rd.flatten() {
        if ctx.cancel.load(Relaxed) {
            break;
        }
        let Ok(ft) = e.file_type() else { continue };
        if ft.is_symlink() {
            continue;
        }
        let Ok(md) = e.metadata() else { continue };
        if is_reparse(&md) {
            continue;
        }
        let fname = e.file_name().to_string_lossy().into_owned();
        if ft.is_dir() {
            subdirs.push((e.path(), fname));
        } else {
            let len = md.len();
            bytes += len;
            let ext = match fname.rfind('.') {
                Some(i) if i + 1 < fname.len() => fname[i + 1..].to_ascii_lowercase(),
                _ => String::new(),
            };
            let s = local.entry(ext).or_insert((0, 0));
            s.0 += len;
            s.1 += 1;
            files.push((fname, len));
        }
    }

    ctx.files.fetch_add(files.len() as u64, Relaxed);
    ctx.bytes.fetch_add(bytes, Relaxed);
    if !local.is_empty() {
        let mut g = ctx.exts.lock().unwrap();
        for (k, (b, c)) in local {
            let s = g.entry(k).or_insert((0, 0));
            s.0 += b;
            s.1 += c;
        }
    }

    node.s = bytes;
    node.f = files.len() as u64;

    if files.len() > KEEP_FILES {
        files.select_nth_unstable_by(KEEP_FILES, |a, b| b.1.cmp(&a.1));
        let rest = files.split_off(KEEP_FILES);
        let rest_s: u64 = rest.iter().map(|f| f.1).sum();
        node.c.push(Node { n: "Small files".into(), s: rest_s, f: rest.len() as u64, k: 2, c: vec![] });
    }
    for (n, s) in files {
        node.c.push(Node { n, s, f: 1, k: 1, c: vec![] });
    }

    let kids: Vec<Node> = subdirs.into_par_iter().map(|(p, n)| walk(&p, n, ctx)).collect();
    for k in kids {
        node.s += k.s;
        node.f += k.f;
        node.c.push(k);
    }
    node
}

/// Drop items below `min` bytes into a per-directory "Small files" node so the IPC payload stays small.
fn prune(node: &mut Node, min: u64) {
    let old = std::mem::take(&mut node.c);
    let (mut rest_s, mut rest_f) = (0u64, 0u64);
    let mut misc: Option<usize> = None;
    for mut ch in old {
        if ch.k == 2 {
            misc = Some(node.c.len());
            node.c.push(ch);
        } else if ch.s < min {
            rest_s += ch.s;
            rest_f += ch.f;
        } else {
            if ch.k == 0 {
                prune(&mut ch, min);
            }
            node.c.push(ch);
        }
    }
    if rest_s > 0 || rest_f > 0 {
        match misc {
            Some(i) => {
                node.c[i].s += rest_s;
                node.c[i].f += rest_f;
            }
            None => node.c.push(Node { n: "Small files".into(), s: rest_s, f: rest_f, k: 2, c: vec![] }),
        }
    }
    node.c.sort_unstable_by(|a, b| b.s.cmp(&a.s));
}

fn run_scan(app: AppHandle, path: String, cancel: Arc<AtomicBool>) -> Result<ScanResult, String> {
    let start = Instant::now();
    let ctx = Arc::new(Ctx {
        cancel: cancel.clone(),
        files: AtomicU64::new(0),
        dirs: AtomicU64::new(0),
        bytes: AtomicU64::new(0),
        exts: Mutex::new(HashMap::new()),
    });

    let done = Arc::new(AtomicBool::new(false));
    let ticker = {
        let (ctx, done, app) = (ctx.clone(), done.clone(), app.clone());
        std::thread::spawn(move || {
            while !done.load(Relaxed) {
                let _ = app.emit(
                    "scan-progress",
                    Progress { files: ctx.files.load(Relaxed), dirs: ctx.dirs.load(Relaxed), bytes: ctx.bytes.load(Relaxed) },
                );
                std::thread::sleep(Duration::from_millis(60));
            }
        })
    };

    let mut mode = "walk";
    let mut fallback: Option<String> = None;
    let mut mft_root: Option<Node> = None;
    #[cfg(windows)]
    if is_elevated() {
        match mft::scan(&path, &ctx) {
            Ok(n) => {
                mode = "mft";
                mft_root = Some(n);
            }
            Err(e) if cancel.load(Relaxed) => drop(e),
            Err(e) => {
                fallback = Some(e);
                ctx.files.store(0, Relaxed);
                ctx.dirs.store(0, Relaxed);
                ctx.bytes.store(0, Relaxed);
                ctx.exts.lock().unwrap().clear();
            }
        }
    }

    let mut root = match mft_root {
        Some(r) => r,
        None if cancel.load(Relaxed) => Node::default(),
        None => {
            // The walk is IO-latency bound, so oversubscribe the cores.
            let threads = (std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4) * 2).clamp(8, 32);
            let pool = rayon::ThreadPoolBuilder::new().num_threads(threads).build().map_err(|e| e.to_string())?;
            pool.install(|| walk(Path::new(&path), path.clone(), &ctx))
        }
    };

    done.store(true, Relaxed);
    let _ = ticker.join();
    if cancel.load(Relaxed) {
        return Err("cancelled".into());
    }

    let min = (root.s / 150_000).max(32 * 1024);
    prune(&mut root, min);

    let mut exts: Vec<ExtStat> =
        ctx.exts.lock().unwrap().iter().map(|(e, (b, c))| ExtStat { e: e.clone(), b: *b, c: *c }).collect();
    exts.sort_unstable_by(|a, b| b.b.cmp(&a.b));
    exts.truncate(400);

    Ok(ScanResult {
        root,
        exts,
        elapsed_ms: start.elapsed().as_millis() as u64,
        files: ctx.files.load(Relaxed),
        dirs: ctx.dirs.load(Relaxed),
        bytes: ctx.bytes.load(Relaxed),
        mode,
        fallback,
    })
}

#[cfg(windows)]
fn is_elevated() -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY};
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
    unsafe {
        let mut token: HANDLE = std::ptr::null_mut();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
            return false;
        }
        let mut e = TOKEN_ELEVATION { TokenIsElevated: 0 };
        let mut ret = 0u32;
        let ok = GetTokenInformation(
            token,
            TokenElevation,
            &mut e as *mut _ as *mut _,
            std::mem::size_of::<TOKEN_ELEVATION>() as u32,
            &mut ret,
        );
        CloseHandle(token);
        ok != 0 && e.TokenIsElevated != 0
    }
}

/// True when running from an MSIX package (Microsoft Store build).
#[tauri::command]
fn packaged() -> bool {
    #[cfg(windows)]
    unsafe {
        use windows_sys::Win32::Storage::Packaging::Appx::GetCurrentPackageFullName;
        const APPMODEL_ERROR_NO_PACKAGE: u32 = 15700;
        let mut len = 0u32;
        GetCurrentPackageFullName(&mut len, std::ptr::null_mut()) != APPMODEL_ERROR_NO_PACKAGE
    }
    #[cfg(not(windows))]
    false
}

#[tauri::command]
fn elevated() -> bool {
    #[cfg(windows)]
    return is_elevated();
    #[cfg(not(windows))]
    false
}

/// Starts a second, elevated copy of the app via UAC and quits this one if the user accepts.
#[tauri::command]
fn relaunch_admin(app: AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let cmd = format!("Start-Process -FilePath '{}' -Verb RunAs", exe.display().to_string().replace('\'', "''"));
        let st = std::process::Command::new("powershell")
            .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
            .args(["-NoProfile", "-NonInteractive", "-Command", &cmd])
            .status()
            .map_err(|e| e.to_string())?;
        if !st.success() {
            return Err("Administrator access was not granted".into());
        }
        app.exit(0);
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        Err("unsupported".into())
    }
}

#[tauri::command]
async fn scan(app: AppHandle, state: State<'_, ScanState>, path: String) -> Result<ScanResult, String> {
    state.cancel.store(false, Relaxed);
    let cancel = state.cancel.clone();
    tauri::async_runtime::spawn_blocking(move || run_scan(app, path, cancel))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn cancel_scan(state: State<'_, ScanState>) {
    state.cancel.store(true, Relaxed);
}

#[tauri::command]
fn drives() -> Vec<Drive> {
    let disks = sysinfo::Disks::new_with_refreshed_list();
    let mut out: Vec<Drive> = disks
        .list()
        .iter()
        .map(|d| Drive {
            mount: d.mount_point().to_string_lossy().into_owned(),
            name: d.name().to_string_lossy().into_owned(),
            total: d.total_space(),
            free: d.available_space(),
        })
        .collect();
    out.sort_by(|a, b| a.mount.cmp(&b.mount));
    out
}

#[tauri::command]
fn reveal(path: String) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("explorer").raw_arg(format!("/select,\"{}\"", path)).spawn();
    }
    #[cfg(not(windows))]
    let _ = path;
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(ScanState::default())
        .invoke_handler(tauri::generate_handler![scan, cancel_scan, drives, reveal, elevated, packaged, relaunch_admin])
        .run(tauri::generate_context!())
        .expect("error while running InDiskitive");
}



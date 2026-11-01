//! data/raw 以下の zip を探して読む。

use crate::fgd::{ArchiveName, Feature, parse_archive_name, parse_fgd_xml};
use anyhow::{Context, Result};
use std::collections::BTreeMap;
use std::io::Read;
use std::path::{Path, PathBuf};

/// 対応している項目番号
pub const SUPPORTED_ITEMS: [(&str, &str); 2] = [("05", "行政区画"), ("12", "町字界")];

#[derive(Debug, Clone)]
pub struct Archive {
    pub name: ArchiveName,
    pub path: PathBuf,
}

/// 再帰的に zip を探す。同じメッシュ・項目が複数あれば日付の新しいものを採用する
pub fn find_archives(dir: &Path) -> Result<Vec<Archive>> {
    let mut latest: BTreeMap<(String, String), Archive> = BTreeMap::new();
    for entry in walkdir::WalkDir::new(dir) {
        let entry = entry.with_context(|| format!("{} を読めません", dir.display()))?;
        if !entry.file_type().is_file() {
            continue;
        }
        let Some(name) = entry.file_name().to_str().and_then(parse_archive_name) else {
            continue;
        };
        if !SUPPORTED_ITEMS.iter().any(|(item, _)| *item == name.item) {
            eprintln!(
                "skip (未対応の項目 {}): {}",
                name.item,
                entry.path().display()
            );
            continue;
        }
        let key = (name.mesh.clone(), name.item.clone());
        if latest
            .get(&key)
            .is_none_or(|prev| prev.name.date < name.date)
        {
            latest.insert(
                key,
                Archive {
                    name,
                    path: entry.path().to_path_buf(),
                },
            );
        }
    }
    Ok(latest.into_values().collect())
}

/// zip 内の FG-GML-*.xml をすべて読む
pub fn read_archive(archive: &Archive, want: impl Fn(&str) -> bool + Copy) -> Result<Vec<Feature>> {
    let file = std::fs::File::open(&archive.path)?;
    let mut zip = zip::ZipArchive::new(std::io::BufReader::new(file))
        .with_context(|| format!("{} を展開できません", archive.path.display()))?;
    let mut features = Vec::new();
    let mut buf = Vec::new();
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i)?;
        let name = entry.name()?.to_string();
        if !(name.starts_with("FG-GML-") && name.ends_with(".xml")) {
            continue;
        }
        buf.clear();
        entry.read_to_end(&mut buf)?;
        features.extend(
            parse_fgd_xml(&buf, want)
                .with_context(|| format!("{} / {name}", archive.path.display()))?,
        );
    }
    Ok(features)
}

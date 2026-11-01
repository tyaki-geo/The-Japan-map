//! data/edited への書き出し。形式は src/types/index.ts と data/README.md を参照。

use crate::geom::{BBox, MultiPoly, Pt, round_deg, round_ring};
use anyhow::{Context, Result};
use serde::Serialize;
use serde_json::{Map, Value, json};
use std::collections::BTreeMap;
use std::io::{BufWriter, Write};
use std::path::Path;

/// 詳細データの小数桁（約0.1m）
pub const DETAIL_DECIMALS: u32 = 6;
/// 全体表示用の小数桁（約1m）
pub const OVERVIEW_DECIMALS: u32 = 5;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatasetIndex {
    pub generated_at: String,
    pub source: Source,
    pub prefectures: Vec<PrefectureEntry>,
}

#[derive(Serialize)]
pub struct Source {
    pub name: String,
    pub url: String,
    pub meshes: Vec<String>,
    pub items: BTreeMap<String, usize>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrefectureEntry {
    pub code: String,
    pub name: String,
    pub bbox: [f64; 4],
    pub municipalities: Vec<MunicipalityEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MunicipalityEntry {
    pub code: String,
    pub name: String,
    #[serde(rename = "type")]
    pub type_: String,
    pub area_km2: f64,
    pub bbox: [f64; 4],
    pub center: [f64; 2],
    pub has_towns: bool,
    pub town_count: usize,
    pub dir: String,
}

pub fn bbox_json(b: &BBox) -> [f64; 4] {
    let d = DETAIL_DECIMALS;
    [
        round_deg(b.min.x, d),
        round_deg(b.min.y, d),
        round_deg(b.max.x, d),
        round_deg(b.max.y, d),
    ]
}

pub fn point_json(p: Pt) -> [f64; 2] {
    [
        round_deg(p.x, DETAIL_DECIMALS),
        round_deg(p.y, DETAIL_DECIMALS),
    ]
}

/// Polygon / MultiPolygon の GeoJSON ジオメトリ。丸めで潰れた環は除く
pub fn polygon_geometry(mp: &MultiPoly, decimals: u32) -> Option<Value> {
    let polys: Vec<Vec<Vec<[f64; 2]>>> = mp
        .iter()
        .filter_map(|poly| {
            let outer = round_ring(poly.first()?, decimals)?;
            let mut rings = vec![outer];
            rings.extend(poly[1..].iter().filter_map(|h| round_ring(h, decimals)));
            Some(rings)
        })
        .collect();
    match polys.len() {
        0 => None,
        1 => Some(json!({ "type": "Polygon", "coordinates": polys[0] })),
        _ => Some(json!({ "type": "MultiPolygon", "coordinates": polys })),
    }
}

pub fn point_geometry(p: Pt) -> Value {
    json!({ "type": "Point", "coordinates": point_json(p) })
}

pub fn feature(properties: Map<String, Value>, geometry: Value) -> Value {
    json!({ "type": "Feature", "properties": properties, "geometry": geometry })
}

pub fn feature_collection(features: Vec<Value>) -> Value {
    json!({ "type": "FeatureCollection", "features": features })
}

pub fn write_json(path: &Path, value: &impl Serialize) -> Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let file =
        std::fs::File::create(path).with_context(|| format!("{} を書けません", path.display()))?;
    let mut w = BufWriter::new(file);
    serde_json::to_writer(&mut w, value)?;
    w.flush()?;
    Ok(())
}

/// 現在時刻の ISO 8601（UTC、ミリ秒まで）
pub fn now_iso8601() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs() as i64;
    let (days, rem) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    // Howard Hinnant の civil_from_days
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.{:03}Z",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60,
        now.subsec_millis()
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geom::SCALE;

    #[test]
    fn polygon_geometry_closes_rings() {
        let mp: MultiPoly = vec![vec![vec![
            Pt::new(0, 0),
            Pt::new(SCALE, 0),
            Pt::new(SCALE, SCALE),
        ]]];
        let g = polygon_geometry(&mp, 6).unwrap();
        assert_eq!(g["type"], "Polygon");
        assert_eq!(g["coordinates"][0].as_array().unwrap().len(), 4);
    }

    #[test]
    fn iso8601_shape() {
        let s = now_iso8601();
        assert_eq!(s.len(), 24);
        assert!(s.ends_with('Z') && s.as_bytes()[10] == b'T');
    }
}

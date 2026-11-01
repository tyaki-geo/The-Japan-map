//! data/raw の基盤地図情報（FG-GML zip）を都道府県 → 市区町村 → 町・大字に整理して data/edited へ出力する。
//!
//! 入力: data/raw/**/FG-GML-{メッシュ}-{項目}-{日付}.zip
//!   05 行政区画 : AdmArea（2次メッシュで分割された市区町村ポリゴン）
//!   12 町字界   : CommBdry（町字界線）, CommPt（大字・町・丁目の代表点）
//! 出力: data/README.md を参照。手順の詳細は CLAUDE.md の「地区割の方法」。
//!
//! 使い方: japan-map-converter [--raw data/raw] [--out data/edited]

mod archive;
mod fgd;
mod geom;
mod output;
mod prefectures;
mod simplify;
mod towns;

use anyhow::{Result, bail};
use fgd::Geometry;
use geom::{BBox, MultiPoly, Poly, Pt, multi_contains, union};
use output::{DETAIL_DECIMALS, OVERVIEW_DECIMALS};
use rayon::prelude::*;
use serde_json::{Map, Value, json};
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::time::Instant;
use towns::{TownArea, TownPoint, build_town_areas};

const TOWN_BOUNDARY_TYPE: &str = "大字・町・丁目界";
/// 全体表示用の簡略化の許容距離 [m]
const OVERVIEW_TOLERANCE_M: f64 = 30.0;
/// 全体表示用で除く小島・穴の面積 [m²]（約45m四方）
const OVERVIEW_MIN_PART_M2: f64 = 2_000.0;

struct Municipality {
    code: String,
    name: String,
    type_: String,
    pref_code: String,
    pref_name: String,
    geometry: MultiPoly,
    bbox: BBox,
}

impl Municipality {
    fn properties(&self) -> Map<String, Value> {
        let v = json!({
            "code": self.code,
            "name": self.name,
            "type": self.type_,
            "prefCode": self.pref_code,
            "prefName": self.pref_name,
        });
        v.as_object().cloned().unwrap_or_default()
    }
}

/// 点がどの市区町村に入るかを引くための格子索引
struct MuniIndex<'a> {
    munis: &'a [Municipality],
    cells: HashMap<(i64, i64), Vec<usize>>,
}

impl<'a> MuniIndex<'a> {
    /// 格子の大きさ（0.05度）
    const CELL: i64 = geom::SCALE / 20;

    fn new(munis: &'a [Municipality]) -> Self {
        let mut cells: HashMap<(i64, i64), Vec<usize>> = HashMap::new();
        for (i, m) in munis.iter().enumerate() {
            for cx in m.bbox.min.x.div_euclid(Self::CELL)..=m.bbox.max.x.div_euclid(Self::CELL) {
                for cy in m.bbox.min.y.div_euclid(Self::CELL)..=m.bbox.max.y.div_euclid(Self::CELL)
                {
                    cells.entry((cx, cy)).or_default().push(i);
                }
            }
        }
        Self { munis, cells }
    }

    fn find(&self, p: Pt) -> Option<usize> {
        let cell = (p.x.div_euclid(Self::CELL), p.y.div_euclid(Self::CELL));
        self.cells
            .get(&cell)?
            .iter()
            .copied()
            .find(|&i| self.munis[i].bbox.contains(p) && multi_contains(&self.munis[i].geometry, p))
    }
}

struct Args {
    raw: PathBuf,
    out: PathBuf,
}

fn parse_args() -> Result<Args> {
    let mut args = Args {
        raw: PathBuf::from("data/raw"),
        out: PathBuf::from("data/edited"),
    };
    let mut it = std::env::args().skip(1);
    while let Some(a) = it.next() {
        match a.as_str() {
            "--raw" => args.raw = it.next().map(PathBuf::from).unwrap_or(args.raw),
            "--out" => args.out = it.next().map(PathBuf::from).unwrap_or(args.out),
            "-h" | "--help" => {
                println!("usage: japan-map-converter [--raw data/raw] [--out data/edited]");
                std::process::exit(0);
            }
            _ => bail!("不明な引数: {a}"),
        }
    }
    Ok(args)
}

fn main() -> Result<()> {
    let args = parse_args()?;
    let started = Instant::now();
    let lap = |label: &str| eprintln!("[{:6.2}s] {label}", started.elapsed().as_secs_f64());

    // ---- 読み込み ----
    let archives = archive::find_archives(&args.raw)?;
    if archives.is_empty() {
        bail!("{} に FG-GML の zip がありません", args.raw.display());
    }
    let features: Vec<fgd::Feature> = archives
        .par_iter()
        .map(|a| archive::read_archive(a, |k| matches!(k, "AdmArea" | "CommBdry" | "CommPt")))
        .collect::<Result<Vec<_>>>()?
        .into_iter()
        .flatten()
        .collect();

    let mut pieces: BTreeMap<String, (String, String, Vec<Poly>)> = BTreeMap::new();
    let mut town_lines: Vec<Vec<Pt>> = Vec::new();
    let mut town_points: Vec<(TownPoint, Option<String>)> = Vec::new();
    for f in features {
        match (f.kind.as_str(), f.geometry) {
            ("AdmArea", Geometry::Polygon(mp)) => {
                if let Some(code) = f.adm_code {
                    let entry = pieces
                        .entry(code)
                        .or_insert_with(|| (f.name.unwrap_or_default(), f.type_, Vec::new()));
                    entry.2.extend(mp);
                }
            }
            ("CommBdry", Geometry::Line(line))
                if f.type_ == TOWN_BOUNDARY_TYPE && line.len() >= 2 =>
            {
                town_lines.push(line)
            }
            ("CommPt", Geometry::Point(pos)) => {
                town_points.push((
                    TownPoint {
                        name: f.name.unwrap_or_default(),
                        pos,
                    },
                    f.adm_code,
                ));
            }
            _ => {}
        }
    }
    lap(&format!(
        "archives: {}, 行政区画ポリゴン片: {}, 町字界線: {}, 町字代表点: {}",
        archives.len(),
        pieces.values().map(|p| p.2.len()).sum::<usize>(),
        town_lines.len(),
        town_points.len()
    ));

    // ---- メッシュ単位のポリゴンを市区町村ごとに統合 ----
    let munis: Vec<Municipality> = pieces
        .into_par_iter()
        .filter_map(|(code, (name, type_, polys))| {
            let geometry = union(&polys, true);
            let bbox = BBox::of_multi(&geometry)?;
            let pref_code = code[..2].to_string();
            Some(Municipality {
                pref_name: prefectures::prefecture_name(&pref_code),
                pref_code,
                code,
                name,
                type_,
                geometry,
                bbox,
            })
        })
        .collect();
    lap(&format!("市区町村: {}", munis.len()));

    // ---- 町字界を市区町村に振り分ける ----
    let index = MuniIndex::new(&munis);
    let mut lines_by_muni: Vec<Vec<Vec<Pt>>> = vec![Vec::new(); munis.len()];
    let mut points_by_muni: Vec<Vec<TownPoint>> = (0..munis.len()).map(|_| Vec::new()).collect();

    // 中央の頂点から順に、市区町村ポリゴン内にある頂点で判定する（海岸沿いの線への対策）
    let line_owner: Vec<Option<usize>> = town_lines
        .par_iter()
        .map(|line| {
            let mid = line.len() / 2;
            line[mid..]
                .iter()
                .chain(line[..mid].iter().rev())
                .find_map(|p| index.find(*p))
        })
        .collect();
    let end_key = |line: &[Pt]| [line[0], line[line.len() - 1]];
    let mut owner_by_end: HashMap<Pt, usize> = HashMap::new();
    let mut pending: Vec<usize> = Vec::new();
    for (i, owner) in line_owner.iter().enumerate() {
        match owner {
            Some(m) => end_key(&town_lines[i]).iter().for_each(|p| {
                owner_by_end.insert(*p, *m);
            }),
            None => pending.push(i),
        }
    }
    let mut owners = line_owner;
    // 湾内など行政区画ポリゴン（陸域）の外にある線は、端点でつながる振り分け済みの線に合わせる
    loop {
        let before = pending.len();
        pending.retain(|&i| {
            let ends = end_key(&town_lines[i]);
            let Some(m) = ends.iter().find_map(|p| owner_by_end.get(p).copied()) else {
                return true;
            };
            owners[i] = Some(m);
            ends.iter().for_each(|p| {
                owner_by_end.insert(*p, m);
            });
            false
        });
        if pending.is_empty() || pending.len() == before {
            break;
        }
    }
    let mut unassigned = pending.len();
    for (line, owner) in town_lines.into_iter().zip(owners) {
        if let Some(m) = owner {
            lines_by_muni[m].push(line);
        }
    }
    let code_to_idx: HashMap<&str, usize> = munis
        .iter()
        .enumerate()
        .map(|(i, m)| (m.code.as_str(), i))
        .collect();
    for (point, adm_code) in town_points {
        // admCode が 00000 などの場合は位置から判定する
        let owner = adm_code
            .as_deref()
            .and_then(|c| code_to_idx.get(c).copied())
            .or_else(|| index.find(point.pos));
        match owner {
            Some(m) => points_by_muni[m].push(point),
            None => unassigned += 1,
        }
    }
    if unassigned > 0 {
        eprintln!("市区町村に振り分けられなかった町字データ: {unassigned}");
    }

    // ---- 町・大字の区域 ----
    let towns: Vec<Vec<TownArea>> = munis
        .par_iter()
        .enumerate()
        .map(|(i, m)| {
            if points_by_muni[i].is_empty() {
                Vec::new()
            } else {
                build_town_areas(&m.geometry, &lines_by_muni[i], &points_by_muni[i])
            }
        })
        .collect();
    lap(&format!(
        "町・大字: {}",
        towns.iter().map(Vec::len).sum::<usize>()
    ));

    // ---- 全体表示用の簡略化と都道府県 ----
    let geometries: Vec<MultiPoly> = munis.iter().map(|m| m.geometry.clone()).collect();
    let simplified: Vec<MultiPoly> = simplify::simplify_shared(&geometries, OVERVIEW_TOLERANCE_M)
        .iter()
        .map(|g| simplify::drop_small_parts(g, OVERVIEW_MIN_PART_M2))
        .collect();
    let mut by_pref: BTreeMap<&str, Vec<&MultiPoly>> = BTreeMap::new();
    for (m, g) in munis.iter().zip(&simplified) {
        by_pref.entry(m.pref_code.as_str()).or_default().push(g);
    }
    let pref_shapes: Vec<(&str, MultiPoly)> = by_pref
        .into_par_iter()
        .map(|(code, gs)| (code, union(gs.into_iter().flatten(), true)))
        .collect();
    lap("簡略化・都道府県");

    write_outputs(
        &args.out,
        &archives,
        &munis,
        &towns,
        &simplified,
        &pref_shapes,
    )?;
    lap(&format!("wrote {}", args.out.display()));
    Ok(())
}

fn write_outputs(
    out: &Path,
    archives: &[archive::Archive],
    munis: &[Municipality],
    towns: &[Vec<TownArea>],
    simplified: &[MultiPoly],
    pref_shapes: &[(&str, MultiPoly)],
) -> Result<()> {
    let pref_dir = out.join("prefectures");
    if pref_dir.exists() {
        std::fs::remove_dir_all(&pref_dir)?;
    }

    // 市区町村ごとの詳細データ
    let entries: Vec<output::MunicipalityEntry> = munis
        .par_iter()
        .zip(towns)
        .map(|(m, areas)| {
            let dir = format!("prefectures/{}/{}", m.pref_code, m.code);
            let boundary = geom_or_empty(output::polygon_geometry(&m.geometry, DETAIL_DECIMALS));
            output::write_json(
                &out.join(&dir).join("boundary.geojson"),
                &output::feature_collection(vec![output::feature(m.properties(), boundary)]),
            )?;
            if !areas.is_empty() {
                let mut features: Vec<Value> = areas
                    .iter()
                    .filter_map(|a| {
                        let props = json!({ "kind": "area", "name": a.name, "count": a.count });
                        let geometry = output::polygon_geometry(&a.geometry, DETAIL_DECIMALS)?;
                        Some(output::feature(
                            props.as_object().cloned().unwrap_or_default(),
                            geometry,
                        ))
                    })
                    .collect();
                features.extend(areas.iter().map(|a| {
                    let props = json!({ "kind": "label", "name": a.name });
                    output::feature(
                        props.as_object().cloned().unwrap_or_default(),
                        output::point_geometry(a.label),
                    )
                }));
                output::write_json(
                    &out.join(&dir).join("towns.geojson"),
                    &output::feature_collection(features),
                )?;
            }
            let center = geom::interior_point(&m.geometry)
                .filter(|p| multi_contains(&m.geometry, *p))
                .unwrap_or_else(|| m.bbox.center());
            Ok(output::MunicipalityEntry {
                code: m.code.clone(),
                name: m.name.clone(),
                type_: m.type_.clone(),
                area_km2: (geom::area_m2(&m.geometry) / 1e4).round() / 100.0,
                bbox: output::bbox_json(&m.bbox),
                center: output::point_json(center),
                has_towns: !areas.is_empty(),
                town_count: areas.len(),
                dir,
            })
        })
        .collect::<Result<_>>()?;

    // index.json
    let mut prefs: BTreeMap<String, (output::PrefectureEntry, BBox)> = BTreeMap::new();
    for (m, entry) in munis.iter().zip(entries) {
        let (pref, bbox) = prefs.entry(m.pref_code.clone()).or_insert_with(|| {
            let p = output::PrefectureEntry {
                code: m.pref_code.clone(),
                name: m.pref_name.clone(),
                bbox: [0.0; 4],
                municipalities: Vec::new(),
            };
            (p, m.bbox)
        });
        *bbox = bbox.merge(&m.bbox);
        pref.municipalities.push(entry);
    }
    let prefectures: Vec<output::PrefectureEntry> = prefs
        .into_values()
        .map(|(mut p, bbox)| {
            p.bbox = output::bbox_json(&bbox);
            p
        })
        .collect();
    let mut items: BTreeMap<String, usize> = BTreeMap::new();
    for a in archives {
        *items.entry(a.name.item.clone()).or_default() += 1;
    }
    let mut meshes: Vec<String> = archives.iter().map(|a| a.name.mesh.clone()).collect();
    meshes.sort();
    meshes.dedup();
    let index = output::DatasetIndex {
        generated_at: output::now_iso8601(),
        source: output::Source {
            name: "基盤地図情報 基本項目（国土地理院）".into(),
            url: "https://service.gsi.go.jp/kiban/".into(),
            meshes,
            items,
        },
        prefectures,
    };
    output::write_json(&out.join("index.json"), &index)?;

    // 全体表示用
    let muni_features: Vec<Value> = munis
        .iter()
        .zip(simplified)
        .filter_map(|(m, g)| {
            Some(output::feature(
                m.properties(),
                output::polygon_geometry(g, OVERVIEW_DECIMALS)?,
            ))
        })
        .collect();
    output::write_json(
        &out.join("municipalities.geojson"),
        &output::feature_collection(muni_features),
    )?;
    let pref_features: Vec<Value> = pref_shapes
        .iter()
        .filter_map(|(code, g)| {
            let props = json!({ "prefCode": code, "prefName": prefectures::prefecture_name(code) });
            Some(output::feature(
                props.as_object().cloned().unwrap_or_default(),
                output::polygon_geometry(g, OVERVIEW_DECIMALS)?,
            ))
        })
        .collect();
    output::write_json(
        &out.join("prefectures.geojson"),
        &output::feature_collection(pref_features),
    )?;
    Ok(())
}

fn geom_or_empty(g: Option<Value>) -> Value {
    g.unwrap_or_else(|| json!({ "type": "MultiPolygon", "coordinates": [] }))
}

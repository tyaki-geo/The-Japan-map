//! 町・大字（市区町村の1段下のまとまり）の区域を作る。
//!
//! 町字界は線と代表点しかないため、市区町村ポリゴンを町字界線で切り分けて区域にし、
//! 区域内の代表点の名称から丁目番号だけを除いた名前で統合する。

use crate::geom::{
    BBox, MultiPoly, Poly, Pt, SCALE, interior_point, multi_contains, poly_contains, union,
};
use i_overlay::core::fill_rule::FillRule;
use i_overlay::string::slice::IntSlice;
use std::collections::{BTreeMap, HashMap};

/// ぶら下がった線端を延ばす長さ [m]
const EXTEND_M: f64 = 1.0;

const KANJI_DIGITS: &str = "一二三四五六七八九十";

fn is_chome_digit(c: char) -> bool {
    c.is_ascii_digit() || ('０'..='９').contains(&c) || KANJI_DIGITS.contains(c)
}

/// 「枝松三丁目」「別当５丁目」→「枝松」「別当」。
/// 除くのは末尾の丁目番号だけで、甲・乙や東西南北などはそのまま残す
pub fn town_group_name(name: &str) -> String {
    let name = name.trim();
    if let Some(head) = name.strip_suffix("丁目") {
        let base = head.trim_end_matches(is_chome_digit);
        if base.len() < head.len() && !base.is_empty() {
            return base.to_string();
        }
    }
    name.to_string()
}

/// 1つの区域に入る代表点の名称から、その区域のまとまり名を決める（最多のもの、同数なら先に出たもの）
pub fn pick_group_name<'a>(names: impl IntoIterator<Item = &'a str>) -> Option<String> {
    let mut order: Vec<(String, usize)> = Vec::new();
    for n in names {
        let g = town_group_name(n);
        match order.iter_mut().find(|(k, _)| *k == g) {
            Some((_, c)) => *c += 1,
            None => order.push((g, 1)),
        }
    }
    let mut best: Option<(String, usize)> = None;
    for (g, c) in order {
        if best.as_ref().is_none_or(|(_, bc)| c > *bc) {
            best = Some((g, c));
        }
    }
    best.map(|(g, _)| g)
}

/// 他の線とつながっていない線端を、線の向きに `EXTEND_M` だけ延ばす。
///
/// 町字界線（1/2500）は市区町村界（1/25000）や他の線にぴったり接しておらず、
/// 1cm 未満の隙間で止まっていることが多い。整数座標で厳密に切り分けると切れないため、
/// 少し突き出させて確実に交差させる。突き出た部分は行き止まりになるだけで区域には影響しない
pub fn extend_dangling_ends(lines: &[Vec<Pt>]) -> Vec<Vec<Pt>> {
    let mut degree: HashMap<Pt, usize> = HashMap::new();
    for line in lines {
        if let (Some(a), Some(b)) = (line.first(), line.last()) {
            *degree.entry(*a).or_default() += 1;
            *degree.entry(*b).or_default() += 1;
        }
    }
    let extend = |end: Pt, prev: Pt| -> Pt {
        let cos_lat = (end.y as f64 / SCALE as f64).to_radians().cos();
        let (dx, dy) = ((end.x - prev.x) as f64 * cos_lat, (end.y - prev.y) as f64);
        let len = (dx * dx + dy * dy).sqrt();
        if len == 0.0 {
            return end;
        }
        // 緯度1度 ≒ 110.6km
        let step = EXTEND_M / 110_574.0 * SCALE as f64 / len;
        Pt::new(
            end.x + (dx * step / cos_lat).round() as i64,
            end.y + (dy * step).round() as i64,
        )
    };
    lines
        .iter()
        .map(|line| {
            let n = line.len();
            if n < 2 {
                return line.clone();
            }
            let mut out = line.clone();
            if degree[&line[n - 1]] == 1 {
                out.push(extend(line[n - 1], line[n - 2]));
            }
            if degree[&line[0]] == 1 {
                out.insert(0, extend(line[0], line[1]));
            }
            out
        })
        .collect()
}

pub struct TownPoint {
    pub name: String,
    pub pos: Pt,
}

pub struct TownArea {
    pub name: String,
    /// 元の大字・町・丁目の数
    pub count: usize,
    pub geometry: MultiPoly,
    pub label: Pt,
}

/// 市区町村ポリゴンを町字界線で切り分け、名前ごとに統合した区域を返す（名前順）。
/// 代表点を含まない区域（町字データの無い範囲や、精度差による細片）は捨てる
pub fn build_town_areas(
    muni: &MultiPoly,
    lines: &[Vec<Pt>],
    points: &[TownPoint],
) -> Vec<TownArea> {
    let pieces: MultiPoly = muni.slice_by_paths(&extend_dangling_ends(lines), FillRule::NonZero);

    let mut groups: BTreeMap<String, (usize, Vec<Poly>)> = BTreeMap::new();
    for piece in pieces {
        let Some(bbox) = piece.first().and_then(BBox::of_points) else {
            continue;
        };
        let inside: Vec<&str> = points
            .iter()
            .filter(|p| bbox.contains(p.pos) && poly_contains(&piece, p.pos))
            .map(|p| p.name.as_str())
            .collect();
        if let Some(name) = pick_group_name(inside.iter().copied()) {
            let entry = groups.entry(name).or_default();
            entry.0 += inside.len();
            entry.1.push(piece);
        }
    }

    groups
        .into_iter()
        .filter_map(|(name, (count, polys))| {
            let geometry = union(&polys, false);
            let label = interior_point(&geometry)
                .filter(|p| multi_contains(&geometry, *p))
                .or_else(|| geometry.first()?.first()?.first().copied())?;
            Some(TownArea {
                name,
                count,
                geometry,
                label,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_only_chome_number() {
        assert_eq!(town_group_name("枝松三丁目"), "枝松");
        assert_eq!(town_group_name("平和通十丁目"), "平和通");
        assert_eq!(town_group_name("別当５丁目"), "別当");
        assert_eq!(town_group_name("栄町港3丁目"), "栄町港");
        assert_eq!(town_group_name("東川町"), "東川町");
        assert_eq!(town_group_name("洲之内甲"), "洲之内甲");
        assert_eq!(town_group_name("余戸南"), "余戸南");
        assert_eq!(town_group_name("三津ふ頭"), "三津ふ頭");
        // 数字の無い「丁目」や名前全体が数字の場合はそのまま
        assert_eq!(town_group_name("丁目"), "丁目");
        assert_eq!(town_group_name("一丁目"), "一丁目");
    }

    #[test]
    fn picks_most_common_then_first() {
        assert_eq!(
            pick_group_name(["三津ふ頭", "三津一丁目", "三津二丁目"]).as_deref(),
            Some("三津")
        );
        assert_eq!(
            pick_group_name(["三津ふ頭", "三津三丁目"]).as_deref(),
            Some("三津ふ頭")
        );
        assert_eq!(pick_group_name([]), None);
    }

    #[test]
    fn extends_only_dangling_ends() {
        let d = SCALE / 100_000; // 約1m
        let lines = vec![
            vec![Pt::new(0, 0), Pt::new(0, 10 * d)],
            vec![Pt::new(0, 10 * d), Pt::new(10 * d, 10 * d)],
        ];
        let out = extend_dangling_ends(&lines);
        // (0,0) 側は南へ、(10d,10d) 側は東へ延び、共有点 (0,10d) はそのまま
        assert_eq!(out[0].len(), 3);
        assert!(out[0][0].y < 0 && out[0][0].x == 0);
        assert_eq!(out[0][2], Pt::new(0, 10 * d));
        assert_eq!(out[1].len(), 3);
        assert!(out[1][2].x > 10 * d);
    }

    #[test]
    fn closes_tiny_gap_to_boundary() {
        // 線が外周の手前 1e-9 度で止まっていても切れる
        let muni: MultiPoly = vec![vec![vec![
            Pt::new(0, 0),
            Pt::new(SCALE / 1000, 0),
            Pt::new(SCALE / 1000, SCALE / 1000),
            Pt::new(0, SCALE / 1000),
        ]]];
        let x = SCALE / 2000;
        let lines = vec![vec![Pt::new(x, 1), Pt::new(x, SCALE / 1000 - 1)]];
        let points = vec![
            TownPoint {
                name: "西".into(),
                pos: Pt::new(x / 2, SCALE / 2000),
            },
            TownPoint {
                name: "東".into(),
                pos: Pt::new(x + x / 2, SCALE / 2000),
            },
        ];
        assert_eq!(build_town_areas(&muni, &lines, &points).len(), 2);
    }

    #[test]
    fn slices_and_groups_by_name() {
        // 10x10 の正方形を x=4, x=7 の2本の線で3つに切り、左2つが同じ町（一丁目・二丁目）
        let muni: MultiPoly = vec![vec![vec![
            Pt::new(0, 0),
            Pt::new(10, 0),
            Pt::new(10, 10),
            Pt::new(0, 10),
        ]]];
        let lines = vec![
            vec![Pt::new(4, -1), Pt::new(4, 11)],
            vec![Pt::new(7, -1), Pt::new(7, 11)],
        ];
        let points = vec![
            TownPoint {
                name: "枝松一丁目".into(),
                pos: Pt::new(2, 5),
            },
            TownPoint {
                name: "枝松二丁目".into(),
                pos: Pt::new(5, 5),
            },
            TownPoint {
                name: "北町".into(),
                pos: Pt::new(9, 5),
            },
        ];
        let areas = build_town_areas(&muni, &lines, &points);
        let summary: Vec<(&str, usize, usize)> = areas
            .iter()
            .map(|a| (a.name.as_str(), a.count, a.geometry.len()))
            .collect();
        assert_eq!(summary, vec![("北町", 1, 1), ("枝松", 2, 1)]);
        let edamatsu = &areas[1].geometry[0][0];
        assert_eq!(BBox::of_points(edamatsu).unwrap().max, Pt::new(7, 10));
        assert!(multi_contains(&areas[1].geometry, areas[1].label));
    }
}

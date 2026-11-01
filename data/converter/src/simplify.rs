//! 隣接する図形の境界を共有したまま簡略化する（全体表示用）。
//!
//! 全図形の環を「節点」（3本以上の辺が集まる点）で区切って弧にし、同じ弧は一度だけ
//! Douglas-Peucker で簡略化してから環を組み立て直す。隣どうしは同じ弧を使うので隙間ができない。

use crate::geom::{MultiPoly, Pt, Ring, SCALE, signed_area2};
use std::collections::{HashMap, HashSet};

/// 地表距離のおおよその換算（度 → m）
const M_PER_DEG_LAT: f64 = 110_574.0;
const M_PER_DEG_LON_EQ: f64 = 111_320.0;

fn ring_edges(ring: &Ring) -> impl Iterator<Item = (Pt, Pt)> + '_ {
    (0..ring.len()).map(move |i| (ring[i], ring[(i + 1) % ring.len()]))
}

/// 3本以上（または1本）の辺が集まる点を節点とする
fn find_nodes(shapes: &[MultiPoly]) -> HashSet<Pt> {
    let mut neighbors: HashMap<Pt, Vec<Pt>> = HashMap::new();
    for ring in shapes.iter().flatten().flatten() {
        for (a, b) in ring_edges(ring) {
            for (p, q) in [(a, b), (b, a)] {
                let list = neighbors.entry(p).or_default();
                if !list.contains(&q) {
                    list.push(q);
                }
            }
        }
    }
    neighbors
        .into_iter()
        .filter(|(_, n)| n.len() != 2)
        .map(|(p, _)| p)
        .collect()
}

/// 向きによらず同じ弧が同じキーになるようにする
fn canonical(arc: &[Pt], closed: bool) -> Vec<Pt> {
    if closed {
        // 節点の無い閉じた環: 最小の点から始め、向きは小さい方
        let n = arc.len();
        let start = (0..n).min_by_key(|&i| (arc[i].x, arc[i].y)).unwrap_or(0);
        let fwd: Vec<Pt> = (0..n).map(|i| arc[(start + i) % n]).collect();
        let bwd: Vec<Pt> = (0..n).map(|i| arc[(start + n - i) % n]).collect();
        let key = |v: &Vec<Pt>| v.iter().map(|p| (p.x, p.y)).collect::<Vec<_>>();
        if key(&fwd) <= key(&bwd) { fwd } else { bwd }
    } else {
        let rev: Vec<Pt> = arc.iter().rev().copied().collect();
        let first = |v: &[Pt]| v.iter().map(|p| (p.x, p.y)).collect::<Vec<_>>();
        if first(arc) <= first(&rev) {
            arc.to_vec()
        } else {
            rev
        }
    }
}

fn to_meters(p: Pt, cos_lat: f64) -> (f64, f64) {
    (
        p.x as f64 / SCALE as f64 * M_PER_DEG_LON_EQ * cos_lat,
        p.y as f64 / SCALE as f64 * M_PER_DEG_LAT,
    )
}

fn seg_dist(p: (f64, f64), a: (f64, f64), b: (f64, f64)) -> f64 {
    let (dx, dy) = (b.0 - a.0, b.1 - a.1);
    let len2 = dx * dx + dy * dy;
    let t = if len2 == 0.0 {
        0.0
    } else {
        (((p.0 - a.0) * dx + (p.1 - a.1) * dy) / len2).clamp(0.0, 1.0)
    };
    let (cx, cy) = (a.0 + t * dx, a.1 + t * dy);
    ((p.0 - cx).powi(2) + (p.1 - cy).powi(2)).sqrt()
}

/// 両端を残す Douglas-Peucker。`keep_one` が真なら、許容距離以下でも最も離れた1点は残す
fn douglas_peucker(points: &[Pt], tolerance_m: f64, keep_one: bool) -> Vec<Pt> {
    if points.len() <= 2 {
        return points.to_vec();
    }
    let cos_lat = (points[0].y as f64 / SCALE as f64).to_radians().cos();
    let m: Vec<(f64, f64)> = points.iter().map(|p| to_meters(*p, cos_lat)).collect();
    let mut keep = vec![false; points.len()];
    keep[0] = true;
    keep[points.len() - 1] = true;
    let mut stack = vec![(0, points.len() - 1)];
    while let Some((s, e)) = stack.pop() {
        let (mut idx, mut max) = (0, 0.0);
        for i in s + 1..e {
            let d = seg_dist(m[i], m[s], m[e]);
            if d > max {
                (idx, max) = (i, d);
            }
        }
        let force = keep_one && s == 0 && e == points.len() - 1 && idx > 0;
        if max > tolerance_m || force {
            keep[idx] = true;
            stack.push((s, idx));
            stack.push((idx, e));
        }
    }
    points
        .iter()
        .zip(keep)
        .filter(|(_, k)| *k)
        .map(|(p, _)| *p)
        .collect()
}

/// 閉じた環（節点なし）の簡略化。最も離れた2点で分けて両側を簡略化する。
/// 小島が潰れないよう、両側で1点ずつは必ず残す（最低4点）
fn simplify_closed(ring: &[Pt], tolerance_m: f64) -> Vec<Pt> {
    let far = (1..ring.len())
        .max_by_key(|&i| {
            let (dx, dy) = (
                (ring[i].x - ring[0].x) as i128,
                (ring[i].y - ring[0].y) as i128,
            );
            dx * dx + dy * dy
        })
        .unwrap_or(0);
    let mut first: Vec<Pt> = douglas_peucker(&ring[..=far], tolerance_m, true);
    let mut second_src: Vec<Pt> = ring[far..].to_vec();
    second_src.push(ring[0]);
    let second = douglas_peucker(&second_src, tolerance_m, true);
    first.pop();
    first.extend(&second[..second.len() - 1]);
    first
}

/// 環の点列を節点で区切った弧の列にする（各弧は節点で始まり節点で終わる）
fn split_ring(ring: &Ring, nodes: &HashSet<Pt>) -> Option<Vec<Vec<Pt>>> {
    let start = ring.iter().position(|p| nodes.contains(p))?;
    let n = ring.len();
    let mut arcs = Vec::new();
    let mut cur = vec![ring[start]];
    for i in 1..=n {
        let p = ring[(start + i) % n];
        cur.push(p);
        if nodes.contains(&p) {
            arcs.push(std::mem::replace(&mut cur, vec![p]));
        }
    }
    Some(arcs)
}

/// 全図形を、境界を共有したまま簡略化する。潰れてしまう環は元の形のまま残す
pub fn simplify_shared(shapes: &[MultiPoly], tolerance_m: f64) -> Vec<MultiPoly> {
    let nodes = find_nodes(shapes);
    let mut cache: HashMap<Vec<Pt>, Vec<Pt>> = HashMap::new();
    let mut simplify_arc = |arc: &[Pt], closed: bool| -> Vec<Pt> {
        let key = canonical(arc, closed);
        let simplified = cache
            .entry(key.clone())
            .or_insert_with(|| {
                if closed {
                    simplify_closed(&key, tolerance_m)
                } else {
                    douglas_peucker(&key, tolerance_m, false)
                }
            })
            .clone();
        let same_dir = if closed {
            // 閉じた環は始点をそろえてあるので、向きだけ比べる
            (signed_area2(arc) > 0) == (signed_area2(&key) > 0)
        } else {
            key.as_slice() == arc
        };
        if same_dir {
            simplified
        } else {
            simplified.into_iter().rev().collect()
        }
    };

    shapes
        .iter()
        .map(|mp| {
            mp.iter()
                .filter_map(|poly| {
                    let rings: Vec<Ring> = poly
                        .iter()
                        .enumerate()
                        .filter_map(|(i, ring)| {
                            let simplified: Ring = match split_ring(ring, &nodes) {
                                Some(arcs) => {
                                    let mut out = Vec::new();
                                    for arc in arcs {
                                        let s = simplify_arc(&arc, false);
                                        out.extend(&s[..s.len() - 1]);
                                    }
                                    out
                                }
                                None => simplify_arc(ring, true),
                            };
                            // 潰れた・向きが反転した環は元の形を使う。穴が潰れたら捨てる
                            let ok = simplified.len() >= 3
                                && (signed_area2(&simplified) > 0) == (signed_area2(ring) > 0);
                            match (ok, i) {
                                (true, _) => Some(simplified),
                                (false, 0) => Some(ring.clone()),
                                (false, _) => None,
                            }
                        })
                        .collect();
                    (!rings.is_empty()).then_some(rings)
                })
                .collect()
        })
        .collect()
}

/// 環のおおよその面積 [m²]
fn ring_area_m2(ring: &[Pt]) -> f64 {
    let Some(first) = ring.first() else {
        return 0.0;
    };
    let cos_lat = (first.y as f64 / SCALE as f64).to_radians().cos();
    let deg2 = (signed_area2(ring) as f64 / 2.0).abs() / (SCALE as f64 * SCALE as f64);
    deg2 * M_PER_DEG_LON_EQ * cos_lat * M_PER_DEG_LAT
}

/// `min_m2` より小さい島（ポリゴンの部分）と穴を除く。最も大きい部分は必ず残す
pub fn drop_small_parts(mp: &MultiPoly, min_m2: f64) -> MultiPoly {
    let largest =
        (0..mp.len()).max_by(|&a, &b| ring_area_m2(&mp[a][0]).total_cmp(&ring_area_m2(&mp[b][0])));
    mp.iter()
        .enumerate()
        .filter(|(i, poly)| Some(*i) == largest || ring_area_m2(&poly[0]) >= min_m2)
        .map(|(_, poly)| {
            let mut kept = vec![poly[0].clone()];
            kept.extend(
                poly[1..]
                    .iter()
                    .filter(|h| ring_area_m2(h) >= min_m2)
                    .cloned(),
            );
            kept
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const D: i64 = SCALE / 1000; // 約100m

    #[test]
    fn neighbours_keep_shared_border() {
        // 2つの正方形が、細かくぎざぎざした共有境界（x=10D 付近）で接している
        let border: Vec<Pt> = (0..=10)
            .map(|i| Pt::new(10 * D + if i % 2 == 0 { 0 } else { D / 100 }, i * D))
            .collect();
        let mut left: Ring = vec![Pt::new(0, 0)];
        left.extend(border.iter().copied());
        left.push(Pt::new(0, 10 * D));
        let mut right: Ring = vec![Pt::new(20 * D, 0), Pt::new(20 * D, 10 * D)];
        right.extend(border.iter().rev().copied());
        let left = crate::geom::normalize_poly(vec![left]);
        let right = crate::geom::normalize_poly(vec![right]);

        let out = simplify_shared(&[vec![left], vec![right]], 30.0);
        let l: HashSet<Pt> = out[0][0][0].iter().copied().collect();
        let r: HashSet<Pt> = out[1][0][0].iter().copied().collect();
        // ぎざぎざ（約1m）は消え、共有境界の点は両側で同じ
        assert_eq!(out[0][0][0].len(), 4);
        assert_eq!(l.intersection(&r).count(), 2);
        assert!(l.contains(&Pt::new(10 * D, 0)) && l.contains(&Pt::new(10 * D, 10 * D)));
    }

    #[test]
    fn drops_small_islands_but_keeps_largest() {
        let sq = |x: i64, size: i64| {
            vec![vec![
                Pt::new(x, 0),
                Pt::new(x + size, 0),
                Pt::new(x + size, size),
                Pt::new(x, size),
            ]]
        };
        // 約1m四方と約100m四方
        let tiny = sq(0, SCALE / 100_000);
        let big = sq(SCALE, SCALE / 1000);
        assert_eq!(
            drop_small_parts(&vec![tiny.clone(), big.clone()], 2000.0),
            vec![big]
        );
        assert_eq!(drop_small_parts(&vec![tiny.clone()], 2000.0), vec![tiny]);
    }

    #[test]
    fn tiny_island_keeps_shape() {
        let island: Ring = vec![
            Pt::new(0, 0),
            Pt::new(10, 0),
            Pt::new(10, 10),
            Pt::new(0, 10),
        ];
        let out = simplify_shared(&[vec![vec![island.clone()]]], 30.0);
        assert_eq!(out[0][0][0].len(), 4);
    }
}

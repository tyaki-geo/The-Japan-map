//! 図形の基本型と演算。
//!
//! 座標は経度・緯度を 1e-9 度単位の整数（i64）で持つ。基盤地図情報の座標は小数9桁なので
//! 誤差なく表せ、別々に計算した図形どうしでも同じ点は必ず同じ値になる。

use geo::{ChamberlainDuquetteArea, InteriorPoint};
use i_overlay::core::fill_rule::FillRule;
use i_overlay::core::overlay::{IntOverlayOptions, Overlay, ShapeType};
use i_overlay::core::overlay_rule::OverlayRule;
use i_overlay::core::solver::Solver;
use i_overlay::i_float::int::point::IntPoint;

/// [経度, 緯度]（1e-9 度単位）
pub type Pt = IntPoint<i64>;
/// 閉じていない環（始点を末尾に繰り返さない）
pub type Ring = Vec<Pt>;
/// [外周, 穴...]。外周は反時計回り、穴は時計回り
pub type Poly = Vec<Ring>;
pub type MultiPoly = Vec<Poly>;

/// 1度あたりの単位数
pub const SCALE: i64 = 1_000_000_000;

/// [west, south, east, north]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BBox {
    pub min: Pt,
    pub max: Pt,
}

impl BBox {
    pub fn of_points<'a>(points: impl IntoIterator<Item = &'a Pt>) -> Option<BBox> {
        let mut it = points.into_iter();
        let first = *it.next()?;
        let mut b = BBox {
            min: first,
            max: first,
        };
        for p in it {
            b.extend(*p);
        }
        Some(b)
    }

    pub fn of_multi(mp: &MultiPoly) -> Option<BBox> {
        BBox::of_points(mp.iter().flatten().flatten())
    }

    pub fn extend(&mut self, p: Pt) {
        self.min.x = self.min.x.min(p.x);
        self.min.y = self.min.y.min(p.y);
        self.max.x = self.max.x.max(p.x);
        self.max.y = self.max.y.max(p.y);
    }

    pub fn merge(&self, o: &BBox) -> BBox {
        let mut b = *self;
        b.extend(o.min);
        b.extend(o.max);
        b
    }

    pub fn contains(&self, p: Pt) -> bool {
        p.x >= self.min.x && p.x <= self.max.x && p.y >= self.min.y && p.y <= self.max.y
    }

    pub fn center(&self) -> Pt {
        Pt::new((self.min.x + self.max.x) / 2, (self.min.y + self.max.y) / 2)
    }
}

/// 環の符号付き面積の2倍（反時計回りが正）
pub fn signed_area2(ring: &[Pt]) -> i128 {
    let n = ring.len();
    (0..n)
        .map(|i| {
            let a = ring[i];
            let b = ring[(i + 1) % n];
            a.x as i128 * b.y as i128 - b.x as i128 * a.y as i128
        })
        .sum()
}

/// 外周を反時計回り、穴を時計回りにそろえる
pub fn normalize_poly(mut poly: Poly) -> Poly {
    for (i, ring) in poly.iter_mut().enumerate() {
        let ccw = signed_area2(ring) > 0;
        if (i == 0) != ccw {
            ring.reverse();
        }
    }
    poly
}

/// 偶奇判定による点の内外判定（境界上の扱いは不定）
pub fn ring_contains(ring: &[Pt], p: Pt) -> bool {
    let n = ring.len();
    let mut inside = false;
    let mut j = n - 1;
    for i in 0..n {
        let (a, b) = (ring[i], ring[j]);
        if (a.y > p.y) != (b.y > p.y) {
            // p.x < a.x + (p.y - a.y) * (b.x - a.x) / (b.y - a.y) を整数で判定
            let lhs = (p.x - a.x) as i128 * (b.y - a.y) as i128;
            let rhs = (p.y - a.y) as i128 * (b.x - a.x) as i128;
            if (b.y > a.y && lhs < rhs) || (b.y < a.y && lhs > rhs) {
                inside = !inside;
            }
        }
        j = i;
    }
    inside
}

pub fn poly_contains(poly: &Poly, p: Pt) -> bool {
    poly.first().is_some_and(|outer| ring_contains(outer, p))
        && !poly[1..].iter().any(|h| ring_contains(h, p))
}

pub fn multi_contains(mp: &MultiPoly, p: Pt) -> bool {
    mp.iter().any(|poly| poly_contains(poly, p))
}

/// 図形の和（重なり・接する辺を統合する）。
/// `keep_points` が真なら入力の頂点をそのまま残す（隣接図形と境界の頂点をそろえたいとき）
pub fn union<'a>(polys: impl IntoIterator<Item = &'a Poly>, keep_points: bool) -> MultiPoly {
    let options = if keep_points {
        IntOverlayOptions::keep_all_points()
    } else {
        IntOverlayOptions::default()
    };
    let mut overlay = Overlay::<i64>::new_custom(1024, options, Solver::default());
    for poly in polys {
        overlay.add_source(poly, ShapeType::Subject);
    }
    overlay.overlay(OverlayRule::Subject, FillRule::NonZero)
}

fn to_geo(mp: &MultiPoly) -> geo::MultiPolygon<f64> {
    let ring = |r: &Ring| {
        geo::LineString::from(
            r.iter()
                .map(|p| (to_deg(p.x), to_deg(p.y)))
                .collect::<Vec<_>>(),
        )
    };
    geo::MultiPolygon(
        mp.iter()
            .filter(|p| !p.is_empty())
            .map(|p| geo::Polygon::new(ring(&p[0]), p[1..].iter().map(ring).collect()))
            .collect(),
    )
}

/// 球面上の面積 [m²]
pub fn area_m2(mp: &MultiPoly) -> f64 {
    to_geo(mp).chamberlain_duquette_unsigned_area()
}

/// 図形の内側にある代表点（ラベル位置）
pub fn interior_point(mp: &MultiPoly) -> Option<Pt> {
    let p = to_geo(mp).interior_point()?;
    Some(Pt::new(from_deg(p.x()), from_deg(p.y())))
}

pub fn to_deg(v: i64) -> f64 {
    v as f64 / SCALE as f64
}

pub fn from_deg(v: f64) -> i64 {
    (v * SCALE as f64).round() as i64
}

/// 小数 `decimals` 桁に丸めた度の値（出力用）
pub fn round_deg(v: i64, decimals: u32) -> f64 {
    let step = 10_i64.pow(9 - decimals);
    let q = (v as f64 / step as f64).round();
    q / 10_f64.powi(decimals as i32)
}

/// 小数 `decimals` 桁に丸めた座標で環を作り直す。連続する重複点を除き、3点未満になれば None
pub fn round_ring(ring: &[Pt], decimals: u32) -> Option<Vec<[f64; 2]>> {
    let mut out: Vec<[f64; 2]> = Vec::with_capacity(ring.len() + 1);
    for p in ring {
        let q = [round_deg(p.x, decimals), round_deg(p.y, decimals)];
        if out.last() != Some(&q) {
            out.push(q);
        }
    }
    while out.len() > 1 && out.first() == out.last() {
        out.pop();
    }
    if out.len() < 3 {
        return None;
    }
    out.push(out[0]);
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sq(x0: i64, y0: i64, x1: i64, y1: i64) -> Poly {
        vec![vec![
            Pt::new(x0, y0),
            Pt::new(x1, y0),
            Pt::new(x1, y1),
            Pt::new(x0, y1),
        ]]
    }

    #[test]
    fn union_merges_adjacent_squares() {
        let a = sq(0, 0, 10, 10);
        let b = sq(10, 0, 20, 10);
        let result = union([&a, &b], false);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].len(), 1);
        assert_eq!(signed_area2(&result[0][0]), 2 * 200);
    }

    #[test]
    fn union_handles_clockwise_input() {
        let mut a = sq(0, 0, 10, 10);
        a[0].reverse();
        let a = normalize_poly(a);
        assert!(signed_area2(&a[0]) > 0);
        assert_eq!(union([&a], false).len(), 1);
    }

    #[test]
    fn contains_respects_holes() {
        let mut p = sq(0, 0, 10, 10);
        p.push(sq(4, 4, 6, 6).remove(0));
        let p = normalize_poly(p);
        assert!(poly_contains(&p, Pt::new(2, 2)));
        assert!(!poly_contains(&p, Pt::new(5, 5)));
        assert!(!poly_contains(&p, Pt::new(11, 5)));
    }

    #[test]
    fn round_ring_closes_and_dedupes() {
        let r = vec![
            Pt::new(1_000_000_400, 0),
            Pt::new(1_000_000_000, 0),
            Pt::new(2 * SCALE, 0),
            Pt::new(SCALE, SCALE),
        ];
        let out = round_ring(&r, 6).unwrap();
        assert_eq!(out, vec![[1.0, 0.0], [2.0, 0.0], [1.0, 1.0], [1.0, 0.0]]);
    }
}

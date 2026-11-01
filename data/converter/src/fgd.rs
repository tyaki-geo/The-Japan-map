//! 基盤地図情報（FG-GML）の XML を読む。
//!
//! 必要な要素だけをストリーミングで拾う。座標は「緯度 経度」の順なので [経度, 緯度] に入れ替える。

use crate::geom::{MultiPoly, Poly, Pt, Ring, normalize_poly};
use anyhow::{Context, Result, bail};
use quick_xml::Reader;
use quick_xml::events::Event;

#[derive(Debug, Clone, PartialEq)]
pub enum Geometry {
    Polygon(MultiPoly),
    Line(Vec<Pt>),
    Point(Pt),
}

#[derive(Debug, Clone)]
pub struct Feature {
    /// 要素名（AdmArea, CommBdry, CommPt など）
    pub kind: String,
    pub type_: String,
    pub name: Option<String>,
    pub adm_code: Option<String>,
    pub geometry: Geometry,
}

/// zip 名 FG-GML-{2次メッシュ}-{項目番号}-{日付}.zip
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArchiveName {
    pub mesh: String,
    pub item: String,
    pub date: String,
}

pub fn parse_archive_name(file_name: &str) -> Option<ArchiveName> {
    let rest = file_name.strip_prefix("FG-GML-")?.strip_suffix(".zip")?;
    let parts: Vec<&str> = rest.split('-').collect();
    let digits = |s: &str, n: usize| s.len() == n && s.bytes().all(|b| b.is_ascii_digit());
    match parts.as_slice() {
        [mesh, item, date] if digits(mesh, 6) && digits(item, 2) && digits(date, 8) => {
            Some(ArchiveName {
                mesh: mesh.to_string(),
                item: item.to_string(),
                date: date.to_string(),
            })
        }
        _ => None,
    }
}

/// 小数9桁までの10進数を 1e-9 単位の整数に変換する（浮動小数を経由しない）
pub fn parse_nano(s: &str) -> Option<i64> {
    let (neg, s) = match s.strip_prefix('-') {
        Some(rest) => (true, rest),
        None => (false, s),
    };
    let (int, frac) = s.split_once('.').unwrap_or((s, ""));
    if int.is_empty() && frac.is_empty() {
        return None;
    }
    let int: i64 = if int.is_empty() { 0 } else { int.parse().ok()? };
    let mut f: i64 = 0;
    let mut digits = 0;
    let mut round_up = false;
    for (i, b) in frac.bytes().enumerate() {
        if !b.is_ascii_digit() {
            return None;
        }
        if i < 9 {
            f = f * 10 + (b - b'0') as i64;
            digits += 1;
        } else if i == 9 {
            round_up = b >= b'5';
        }
    }
    f *= 10_i64.pow(9 - digits);
    let v = int * 1_000_000_000 + f + round_up as i64;
    Some(if neg { -v } else { v })
}

fn parse_pos_list(text: &str) -> Result<Vec<Pt>> {
    let nums = text
        .split_ascii_whitespace()
        .map(|t| parse_nano(t).with_context(|| format!("座標を読めません: {t}")))
        .collect::<Result<Vec<_>>>()?;
    if nums.len() % 2 != 0 {
        bail!("座標の数が奇数です");
    }
    let (pairs, _) = nums.as_chunks::<2>();
    Ok(pairs.iter().map(|[lat, lon]| Pt::new(*lon, *lat)).collect())
}

/// 連続する曲線の継ぎ目（同一点）を重複させずにつなぐ
fn append_points(dst: &mut Vec<Pt>, src: Vec<Pt>) {
    let skip = usize::from(dst.last().is_some() && dst.last() == src.first());
    dst.extend(src.into_iter().skip(skip));
}

fn close_ring(mut coords: Vec<Pt>) -> Ring {
    while coords.len() > 1 && coords.first() == coords.last() {
        coords.pop();
    }
    coords
}

#[derive(Default)]
struct FeatureBuilder {
    kind: String,
    type_: String,
    name: Option<String>,
    adm_code: Option<String>,
    /// 読み途中の曲線・環の座標
    coords: Vec<Pt>,
    rings: Poly,
    polygons: MultiPoly,
    point: Option<Pt>,
    has_surface: bool,
    has_curve: bool,
}

impl FeatureBuilder {
    fn finish(self) -> Option<Feature> {
        let geometry = if self.has_surface {
            Geometry::Polygon(self.polygons)
        } else if let Some(p) = self.point {
            Geometry::Point(p)
        } else if self.has_curve {
            Geometry::Line(self.coords)
        } else {
            return None;
        };
        Some(Feature {
            kind: self.kind,
            type_: self.type_,
            name: self.name,
            adm_code: self.adm_code,
            geometry,
        })
    }
}

fn resolve_entity(name: &str) -> Option<char> {
    match name {
        "amp" => Some('&'),
        "lt" => Some('<'),
        "gt" => Some('>'),
        "quot" => Some('"'),
        "apos" => Some('\''),
        _ => None,
    }
}

/// Dataset 直下の地物を読む。`want` が偽を返す要素名は読み飛ばす
pub fn parse_fgd_xml(xml: &[u8], want: impl Fn(&str) -> bool) -> Result<Vec<Feature>> {
    let mut reader = Reader::from_reader(xml);
    let mut buf = Vec::new();
    let mut features = Vec::new();
    // 開いている要素のローカル名
    let mut stack: Vec<String> = Vec::new();
    let mut current: Option<FeatureBuilder> = None;
    let mut text = String::new();

    loop {
        match reader.read_event_into(&mut buf)? {
            Event::Start(e) => {
                let local = e.local_name().as_ref().to_string();
                stack.push(local);
                text.clear();
                let depth = stack.len();
                let local = stack.last().unwrap().as_str();
                if depth == 2 {
                    // Dataset 直下: 地物の開始（gml:description / gml:name は除く）
                    if local != "description" && local != "name" && want(local) {
                        current = Some(FeatureBuilder {
                            kind: local.to_string(),
                            ..Default::default()
                        });
                    }
                } else if let Some(f) = current.as_mut() {
                    match local {
                        "Surface" => f.has_surface = true,
                        "Curve" if !f.has_surface => f.has_curve = true,
                        "exterior" | "interior" => f.coords.clear(),
                        _ => {}
                    }
                }
            }
            Event::Text(e) if current.is_some() => text.push_str(e.as_ref()),
            Event::GeneralRef(e) if current.is_some() => {
                if let Some(c) = e.resolve_char_ref()?.or_else(|| resolve_entity(e.as_ref())) {
                    text.push(c);
                }
            }
            Event::End(_) => {
                let depth = stack.len();
                let local = stack.pop().unwrap_or_default();
                if depth == 2 {
                    if let Some(f) = current.take().and_then(FeatureBuilder::finish) {
                        features.push(f);
                    }
                } else if let Some(f) = current.as_mut() {
                    match local.as_str() {
                        "type" if depth == 3 => f.type_ = text.trim().to_string(),
                        "name" if depth == 3 => f.name = Some(text.trim().to_string()),
                        "admCode" if depth == 3 => f.adm_code = Some(text.trim().to_string()),
                        "posList" => {
                            let pts = parse_pos_list(&text)?;
                            append_points(&mut f.coords, pts);
                        }
                        // 地物直下の <pos> は gml:Point を包む要素なので、それより深い gml:pos だけ読む
                        "pos" if depth > 3 => f.point = parse_pos_list(&text)?.first().copied(),
                        "exterior" | "interior" => {
                            let ring = close_ring(std::mem::take(&mut f.coords));
                            f.rings.push(ring);
                        }
                        "PolygonPatch" => {
                            let rings = std::mem::take(&mut f.rings);
                            if !rings.is_empty() {
                                f.polygons.push(normalize_poly(rings));
                            }
                        }
                        _ => {}
                    }
                }
                text.clear();
            }
            Event::Eof => break,
            _ => {}
        }
        buf.clear();
    }
    Ok(features)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geom::signed_area2;

    fn wrap(body: &str) -> String {
        format!(
            r#"<?xml version="1.0" encoding="utf-8"?>
<Dataset xmlns:gml="http://www.opengis.net/gml/3.2" xmlns="http://fgd.gsi.go.jp/spec/2008/FGD_GMLSchema" gml:id="Dataset1">
  <gml:description>基盤地図情報メタデータ</gml:description>
  <gml:name>基盤地図情報ダウンロードデータ（GML版）</gml:name>
{body}
</Dataset>"#
        )
    }

    fn ring(pos: &str) -> String {
        format!(
            r#"<gml:Ring><gml:curveMember><gml:Curve gml:id="c"><gml:segments><gml:LineStringSegment>
<gml:posList>{pos}</gml:posList></gml:LineStringSegment></gml:segments></gml:Curve></gml:curveMember></gml:Ring>"#
        )
    }

    const N: i64 = 1_000_000_000;

    #[test]
    fn archive_name() {
        assert_eq!(
            parse_archive_name("FG-GML-503303-05-20261001.zip"),
            Some(ArchiveName {
                mesh: "503303".into(),
                item: "05".into(),
                date: "20261001".into()
            })
        );
        assert_eq!(
            parse_archive_name("FG-GML-503303-05-20261001.zip:Zone.Identifier"),
            None
        );
        assert_eq!(parse_archive_name("readme.txt"), None);
    }

    #[test]
    fn nano() {
        assert_eq!(parse_nano("33.391666667"), Some(33_391_666_667));
        assert_eq!(parse_nano("133.5"), Some(133_500_000_000));
        assert_eq!(parse_nano("34"), Some(34 * N));
        assert_eq!(parse_nano("-1.25"), Some(-1_250_000_000));
        assert_eq!(parse_nano("1.0000000005"), Some(N + 1));
        assert_eq!(parse_nano("abc"), None);
    }

    #[test]
    fn adm_area_polygon_with_hole() {
        // 外周は時計回りで与え、反時計回りに直ることも確かめる
        let xml = wrap(&format!(
            r#"<AdmArea gml:id="A1"><fid>a-1</fid>
<area><gml:Surface gml:id="s"><gml:patches><gml:PolygonPatch>
<gml:exterior>{}</gml:exterior>
<gml:interior>{}</gml:interior>
</gml:PolygonPatch></gml:patches></gml:Surface></area>
<type>郡市・東京都の区</type><name>須崎市</name><admCode>39206</admCode>
</AdmArea>"#,
            ring("33.0 133.0\n33.1 133.0\n33.1 133.1\n33.0 133.1\n33.0 133.0"),
            ring("33.01 133.05\n33.01 133.06\n33.02 133.06\n33.01 133.05")
        ));
        let features = parse_fgd_xml(xml.as_bytes(), |_| true).unwrap();
        assert_eq!(features.len(), 1);
        let f = &features[0];
        assert_eq!(f.kind, "AdmArea");
        assert_eq!(f.name.as_deref(), Some("須崎市"));
        assert_eq!(f.adm_code.as_deref(), Some("39206"));
        let Geometry::Polygon(mp) = &f.geometry else {
            panic!("polygon expected")
        };
        assert_eq!(mp.len(), 1);
        assert_eq!(mp[0].len(), 2);
        assert_eq!(mp[0][0].len(), 4, "閉じ点は除く");
        assert!(
            mp[0][0].contains(&Pt::new(133 * N, 33 * N)),
            "[経度, 緯度] に入れ替える"
        );
        assert!(signed_area2(&mp[0][0]) > 0, "外周は反時計回り");
        assert!(signed_area2(&mp[0][1]) < 0, "穴は時計回り");
    }

    #[test]
    fn comm_bdry_and_comm_pt() {
        let xml = wrap(
            r#"<CommBdry gml:id="B1"><fid>b-1</fid>
<loc><gml:Curve gml:id="c"><gml:segments><gml:LineStringSegment>
<gml:posList>33.5 133.5
33.6 133.6</gml:posList></gml:LineStringSegment></gml:segments></gml:Curve></loc>
<type>大字・町・丁目界</type></CommBdry>
<CommPt gml:id="P1"><fid>p-1</fid>
<pos><gml:Point gml:id="p"><gml:pos>33.9 132.8</gml:pos></gml:Point></pos>
<type>大字・町・丁目</type><name>東川町&amp;</name><admCode>38201</admCode></CommPt>"#,
        );
        let features = parse_fgd_xml(xml.as_bytes(), |_| true).unwrap();
        assert_eq!(features.len(), 2);
        assert_eq!(
            features[0].geometry,
            Geometry::Line(vec![
                Pt::new(133_500_000_000, 33_500_000_000),
                Pt::new(133_600_000_000, 33_600_000_000)
            ])
        );
        assert_eq!(features[0].name, None);
        assert_eq!(features[1].name.as_deref(), Some("東川町&"));
        assert_eq!(
            features[1].geometry,
            Geometry::Point(Pt::new(132_800_000_000, 33_900_000_000))
        );
    }

    #[test]
    fn skips_unwanted_kinds() {
        let xml = wrap(
            r#"<AdmPt gml:id="P"><fid>x</fid><pos><gml:Point><gml:pos>33 133</gml:pos></gml:Point></pos></AdmPt>"#,
        );
        assert!(
            parse_fgd_xml(xml.as_bytes(), |k| k != "AdmPt")
                .unwrap()
                .is_empty()
        );
    }
}

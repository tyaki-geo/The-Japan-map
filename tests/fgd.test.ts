import { describe, expect, it } from "vitest";
import { parseArchiveName, parseFgdXml } from "../scripts/lib/fgd";

const wrap = (body: string) => `<?xml version="1.0" encoding="utf-8"?>
<Dataset xmlns:gml="http://www.opengis.net/gml/3.2" xmlns="http://fgd.gsi.go.jp/spec/2008/FGD_GMLSchema" gml:id="Dataset1">
  <gml:description>基盤地図情報メタデータ</gml:description>
  <gml:name>基盤地図情報ダウンロードデータ（GML版）</gml:name>
${body}
</Dataset>`;

const ring = (pos: string) => `<gml:Ring><gml:curveMember><gml:Curve gml:id="c"><gml:segments><gml:LineStringSegment>
<gml:posList>${pos}</gml:posList></gml:LineStringSegment></gml:segments></gml:Curve></gml:curveMember></gml:Ring>`;

describe("parseArchiveName", () => {
  it("メッシュ・項目・日付を取り出す", () => {
    expect(parseArchiveName("FG-GML-503303-05-20261001.zip")).toEqual({
      mesh: "503303",
      item: "05",
      date: "20261001",
    });
  });

  it("対象外のファイルは null", () => {
    expect(parseArchiveName("FG-GML-503303-05-20261001.zip:Zone.Identifier")).toBeNull();
    expect(parseArchiveName("readme.txt")).toBeNull();
  });
});

describe("parseFgdXml", () => {
  it("AdmArea を緯度経度を入れ替えた Polygon（穴あり）にする", () => {
    const xml = wrap(`<AdmArea gml:id="A1">
<fid>a-1</fid>
<area><gml:Surface gml:id="s" srsName="fguuid:jgd2024.bl"><gml:patches><gml:PolygonPatch>
<gml:exterior>${ring("33.0 133.0\n33.0 133.1\n33.1 133.1\n33.0 133.0")}</gml:exterior>
<gml:interior>${ring("33.01 133.05\n33.02 133.06\n33.01 133.06\n33.01 133.05")}</gml:interior>
</gml:PolygonPatch></gml:patches></gml:Surface></area>
<type>郡市・東京都の区</type><name>須崎市</name><admCode>39206</admCode>
</AdmArea>`);
    const [f] = parseFgdXml(xml);
    expect(f).toMatchObject({ kind: "AdmArea", fid: "a-1", name: "須崎市", admCode: "39206" });
    expect(f!.geometry).toEqual({
      type: "Polygon",
      coordinates: [
        [[133.0, 33.0], [133.1, 33.0], [133.1, 33.1], [133.0, 33.0]],
        [[133.05, 33.01], [133.06, 33.02], [133.06, 33.01], [133.05, 33.01]],
      ],
    });
  });

  it("CommBdry を LineString、CommPt を Point にする", () => {
    const xml = wrap(`<CommBdry gml:id="B1"><fid>b-1</fid>
<loc><gml:Curve gml:id="c"><gml:segments><gml:LineStringSegment>
<gml:posList>33.5 133.5
33.6 133.6</gml:posList></gml:LineStringSegment></gml:segments></gml:Curve></loc>
<type>大字・町・丁目界</type></CommBdry>
<CommPt gml:id="P1"><fid>p-1</fid>
<pos><gml:Point gml:id="p"><gml:pos>33.9 132.8</gml:pos></gml:Point></pos>
<type>大字・町・丁目</type><name>東川町</name><admCode>38201</admCode></CommPt>`);
    const features = parseFgdXml(xml);
    expect(features.map((f) => f.kind)).toEqual(["CommBdry", "CommPt"]);
    expect(features[0]!.geometry).toEqual({ type: "LineString", coordinates: [[133.5, 33.5], [133.6, 33.6]] });
    expect(features[0]!.name).toBeUndefined();
    expect(features[1]).toMatchObject({
      name: "東川町",
      admCode: "38201",
      geometry: { type: "Point", coordinates: [132.8, 33.9] },
    });
  });
});

import { describe, expect, it } from "vitest";
import { SUCCESSORS, resolveOffices, type ExtraOffice, type OfficeSource } from "../scripts/offices";

const p05: OfficeSource[] = [
  { code: "38201", name: "松山市役所", lon: 132.765556, lat: 33.839157 },
  { code: "03305", name: "滝沢村役場", lon: 141.077065, lat: 39.734739 },
  { code: "22131", name: "浜松市中区役所", lon: 137.726117, lat: 34.710865 },
  { code: "99999", name: "現在は無い市", lon: 1, lat: 1 },
];
const extra: Record<string, ExtraOffice> = {
  "43101": { name: "熊本市中央区役所", lon: 130.707913, lat: 32.803074, source: "OpenStreetMap" },
};

describe("resolveOffices", () => {
  const codes = ["38201", "03216", "22138", "43101", "01695"];
  const { offices, missing } = resolveOffices(codes, p05, extra);

  it("P05 の庁舎をそのまま使う", () => {
    expect(offices["38201"]).toEqual([132.765556, 33.839157]);
  });

  it("市制施行や区の再編は旧コードの庁舎を引き継ぐ", () => {
    expect(offices["03216"]).toEqual([141.077065, 39.734739]);
    expect(offices["22138"]).toEqual([137.726117, 34.710865]);
  });

  it("P05 に無い区は補う", () => {
    expect(offices["43101"]).toEqual([130.707913, 32.803074]);
  });

  it("庁舎が決まらない市区町村は出さず、missing に挙げる。今は無いコードも出さない", () => {
    expect(offices["01695"]).toBeUndefined();
    expect(missing).toEqual(["01695"]);
    expect(offices["99999"]).toBeUndefined();
    expect(offices["03305"]).toBeUndefined();
  });

  it("引き継ぎ先は旧コードと別のコード", () => {
    for (const [oldCode, newCode] of Object.entries(SUCCESSORS)) expect(oldCode).not.toBe(newCode);
  });
});

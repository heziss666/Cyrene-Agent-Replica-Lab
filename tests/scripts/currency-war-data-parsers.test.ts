import { describe, expect, it } from "vitest";
import { parseCharacterPage } from "../../scripts/currency-war-data/character-parser.mjs";
import { parseBondPage } from "../../scripts/currency-war-data/bond-parser.mjs";

describe("currency war wiki parsers", () => {
  it("parses one character skill group and star stats", () => {
    const page = `
{{货币战争/角色|白厄|费用=3|站位=前|标签=输出|羁绊=救世主
|技能组名称=我独自战斗
|技能组标签=天赋
|技能组描述=获得前台队友的羁绊效果和属性。
|技能组={{货币战争/角色/技能|名称=背负希望|标签=天赋|描述=提高<span>40%/80%/120%</span>。}}
|推荐装备=高周波电锯、热血沸腾拳
}}
{{货币战争/角色/详情
|生命增幅=30%/69%/108%
|基础前台强度=150/240/330
|基础后台强度=0/0/0
|速度增幅=20%/32%/44%
|基础治疗强度=80/80/80
|基础护盾强度=60/60/60
}}`;

    const result = parseCharacterPage(page);

    expect(result.name).toBe("白厄");
    expect(result.cost).toBe(3);
    expect(result.field).toBe("前台");
    expect(result.empowerment.front?.skills[0]).toEqual({
      name: "背负希望",
      tags: ["天赋"],
      description: "提高40%/80%/120%。",
    });
    expect(result.empowerment.back).toBeNull();
    expect(result.empowerment.stars["2"]).toMatchObject({
      生命增幅: "69%",
      基础前台强度: 240,
    });
    expect(result.recommended_equipment).toEqual(["高周波电锯", "热血沸腾拳"]);
  });

  it("parses split front and back groups and merges equipment", () => {
    const page = `
{{货币战争/角色|吉尔伽美什|费用=2|站位=前后|标签=输出|羁绊=命运圣杯、能量
|技能组标题1=前台|技能组名称1=王律键|技能组标签1=天赋
|技能组描述1=前台摘要
|技能组1={{货币战争/角色/技能|名称=前台技能|标签=天赋|描述=前台效果。}}
|推荐装备1=永动机、高周波电锯
|技能组标题2=后台|技能组名称2=王之财宝|技能组标签2=战技、终结技
|技能组描述2=后台摘要
|技能组2={{货币战争/角色/技能|名称=后台技能|标签=战技|描述=后台效果。}}
|推荐装备2=永动机、天基轨道炮
}}
{{货币战争/角色/详情|生命增幅=15%/49%|基础前台强度=125/200|基础后台强度=125/200|速度增幅=10%/21%|基础治疗强度=60/60|基础护盾强度=60/60}}`;

    const result = parseCharacterPage(page);

    expect(result.empowerment.front?.name).toBe("王律键");
    expect(result.empowerment.back?.name).toBe("王之财宝");
    expect(result.empowerment.front?.shared).toBe(false);
    expect(result.recommended_equipment).toEqual(["永动机", "高周波电锯", "天基轨道炮"]);
  });

  it("copies a shared group to both valid positions", () => {
    const page = `
{{货币战争/角色|星期日|费用=3|站位=前后|标签=输出|羁绊=能量
|技能组名称=福泽亲吻的大地|技能组标签=天赋|技能组描述=共用摘要
|技能组={{货币战争/角色/技能|名称=光与我等同在|标签=天赋|描述=共用效果。}}
}}
{{货币战争/角色/详情|生命增幅=30%|基础前台强度=150|基础后台强度=0|速度增幅=20%|基础治疗强度=60|基础护盾强度=60}}`;

    const result = parseCharacterPage(page);

    expect(result.empowerment.front?.shared).toBe(true);
    expect(result.empowerment.back).toEqual(result.empowerment.front);
  });

  it("parses bond base effect, numeric tiers, and special rules", () => {
    const page = `
{{货币战争/羁绊|巡海游侠|阵营羁绊
|描述=队员获得[[文件:货币战争-伤害增幅.png]]伤害增幅。
|羁绊1级=8%伤害增幅。
|羁绊2级=16%伤害增幅。
|提示2=后台角色按星级提供1/3/6/12倍增幅。
}}`;

    expect(parseBondPage(page)).toMatchObject({
      name: "巡海游侠",
      category: "阵营",
      base_effect: "队员获得伤害增幅。",
      effects: { "1": "8%伤害增幅。", "2": "16%伤害增幅。" },
      special_rules: ["后台角色按星级提供1/3/6/12倍增幅。"],
    });
  });
});

import "dotenv/config";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { prisma } from "./plugins/db";
import fs from "node:fs";

type CharacterSource = {
  _id: string;
  stats: {
    baseStats?: Record<string, number>;
    growths?: Record<string, number>;
    bonusStats?: Record<string, number>;
    weaponRanks?: Record<string, string>;
  };
  charData: {
    image?: string;
    name: string;
    shortDescription?: string;
    authority?: number;
    allegiance?: string;
    class?: string;
    level?: number;
    exp?: number;
    expBonus?: number;
  };
  skills?: string[];
  inventory?: Array<{ name: string; type?: string; equipped?: boolean }>;
};

async function loadJson<T>(filePath: string): Promise<T> {
  const raw = await fs.promises.readFile(filePath, "utf-8");
  return JSON.parse(raw) as T;
}

async function loadItemData(filePath: string) {
  const url = pathToFileURL(filePath).href;
  const module = await import(url);
  return module.itemData ?? { items: [] };
}

async function loadSkillData(filePath: string) {
  const url = pathToFileURL(filePath).href;
  const module = await import(url);
  return module.skillArray ?? [];
}

async function seed() {
  const rootDir = path.resolve(__dirname, "..", "..");
  const classDataPath = path.resolve(rootDir, "classData.json");
  const itemDataPath = path.resolve(rootDir, "itemData.js");
  const skillDataPath = path.resolve(rootDir, "skillData.js");
  const characterDataPath = path.resolve(rootDir, "characterData.json");

  const [classData, itemData, skillData, characterData] = await Promise.all([
    loadJson<any[]>(classDataPath),
    loadItemData(itemDataPath),
    loadSkillData(skillDataPath),
    loadJson<CharacterSource[]>(characterDataPath),
  ]);

  for (const entry of classData) {
    await prisma.gameClass.upsert({
      where: { name: entry.name },
      update: {
        description: entry.description,
        growths: entry.growths ?? {},
        baseStats: entry.baseStats ?? {},
        maxStats: entry.maxStats ?? {},
        weaponRanks: entry.weaponRanks ?? {},
        promotesTo: entry.promotesTo ?? [],
        skills: entry.skills ?? [],
        types: entry.types ?? [],
        powerBonus: entry.powerBonus ?? 0,
        expBonus: entry.expBonus ?? 0,
      },
      create: {
        name: entry.name,
        description: entry.description,
        growths: entry.growths ?? {},
        baseStats: entry.baseStats ?? {},
        maxStats: entry.maxStats ?? {},
        weaponRanks: entry.weaponRanks ?? {},
        promotesTo: entry.promotesTo ?? [],
        skills: entry.skills ?? [],
        types: entry.types ?? [],
        powerBonus: entry.powerBonus ?? 0,
        expBonus: entry.expBonus ?? 0,
      },
    });
  }

  for (const entry of skillData) {
    await prisma.skill.upsert({
      where: { name: entry.name },
      update: {
        description: entry.description ?? null,
        activation: entry.activacion ?? entry.activation ?? null,
      },
      create: {
        name: entry.name,
        description: entry.description ?? null,
        activation: entry.activacion ?? entry.activation ?? null,
      },
    });
  }

  const itemBuckets = [
    ...(itemData.items ?? []),
    ...(itemData.sword ?? []),
    ...(itemData.lance ?? []),
    ...(itemData.axe ?? []),
    ...(itemData.bow ?? []),
    ...(itemData.anima ?? []),
    ...(itemData.light ?? []),
    ...(itemData.dark ?? []),
    ...(itemData.staff ?? []),
  ];

  for (const entry of itemBuckets) {
    const isWeapon = entry.type && entry.type !== "item";
    const category = isWeapon ? "WEAPON" : "ITEM";
    const damageType =
      typeof entry.damageType === "number"
        ? entry.damageType === 0
          ? "PHYSICAL"
          : "MAGICAL"
        : null;

    const maxRangeValue = typeof entry.maxRange === "number" ? entry.maxRange : null;
    const rangeFormula = typeof entry.maxRange === "function" ? "floor(mag/2)" : null;

    await prisma.item.upsert({
      where: { name: entry.name },
      update: {
        type: entry.type ?? "item",
        category,
        damageType,
        weaponRank: entry.weaponRank ?? null,
        might: entry.mt ?? null,
        hit: entry.hit ?? null,
        crit: entry.crit ?? null,
        weight: entry.weight ?? null,
        minRange: entry.minRange ?? null,
        maxRange: maxRangeValue,
        rangeFormula,
        weaponExp: entry.wExp ?? null,
        effectiveness: entry.effectiveness ?? null,
        bonus: entry.bonus ?? null,
        uses: entry.usos ?? entry.uses ?? null,
        price: entry.precio ?? entry.price ?? null,
        description: entry.description ?? null,
      },
      create: {
        name: entry.name,
        type: entry.type ?? "item",
        category,
        damageType,
        weaponRank: entry.weaponRank ?? null,
        might: entry.mt ?? null,
        hit: entry.hit ?? null,
        crit: entry.crit ?? null,
        weight: entry.weight ?? null,
        minRange: entry.minRange ?? null,
        maxRange: maxRangeValue,
        rangeFormula,
        weaponExp: entry.wExp ?? null,
        effectiveness: entry.effectiveness ?? null,
        bonus: entry.bonus ?? null,
        uses: entry.usos ?? entry.uses ?? null,
        price: entry.precio ?? entry.price ?? null,
        description: entry.description ?? null,
      },
    });
  }

  const user = await prisma.user.findFirst();
  if (!user) {
    throw new Error("No users found. Create an account before seeding characters.");
  }

  const targetCampaignId = "cmlbdtq4p0002ljvoq3sn576z";
  const campaign = await prisma.campaign.upsert({
    where: { id: targetCampaignId },
    update: {},
    create: {
      id: targetCampaignId,
      name: "Test Campaign",
      createdById: user.id,
      members: {
        create: {
          userId: user.id,
          role: "DM",
        },
      },
    },
  });

  await prisma.campaignMember.upsert({
    where: {
      userId_campaignId: {
        userId: user.id,
        campaignId: campaign.id,
      },
    },
    update: { role: "DM" },
    create: {
      userId: user.id,
      campaignId: campaign.id,
      role: "DM",
    },
  });

  for (const entry of characterData) {
    const className = entry.charData.class ?? null;
    const classRecord = className
      ? await prisma.gameClass.findUnique({ where: { name: className } })
      : null;

    const weaponRanks = entry.stats?.weaponRanks ?? {};
    const weaponSkills = Object.entries(weaponRanks)
      .filter(([, rank]) => rank && rank !== "-")
      .map(([weapon, rank]) => ({ weapon, rank }));

    const character = await prisma.character.upsert({
      where: { id: entry._id },
      update: {
        name: entry.charData.name,
        stats: entry.stats ?? {},
        exp: entry.charData.exp ?? 0,
        level: entry.charData.level ?? 1,
        className,
        classId: classRecord?.id ?? null,
        weaponSkills,
        campaignId: campaign.id,
        kind: "NPC",
      },
      create: {
        id: entry._id,
        name: entry.charData.name,
        stats: entry.stats ?? {},
        exp: entry.charData.exp ?? 0,
        level: entry.charData.level ?? 1,
        className,
        classId: classRecord?.id ?? null,
        weaponSkills,
        campaignId: campaign.id,
        kind: "NPC",
      },
    });

    if (entry.skills?.length) {
      for (const skillName of entry.skills) {
        const skill = await prisma.skill.upsert({
          where: { name: skillName },
          update: {},
          create: { name: skillName },
        });

        await prisma.characterSkill.upsert({
          where: {
            characterId_skillId: {
              characterId: character.id,
              skillId: skill.id,
            },
          },
          update: {},
          create: {
            characterId: character.id,
            skillId: skill.id,
          },
        });
      }
    }

    if (entry.inventory?.length) {
      for (const itemEntry of entry.inventory) {
        const item = await prisma.item.upsert({
          where: { name: itemEntry.name },
          update: {
            type: itemEntry.type ?? "item",
          },
          create: {
            name: itemEntry.name,
            type: itemEntry.type ?? "item",
          },
        });

        await prisma.characterItem.upsert({
          where: {
            characterId_itemId: {
              characterId: character.id,
              itemId: item.id,
            },
          },
          update: {
            equipped: itemEntry.equipped ?? false,
          },
          create: {
            characterId: character.id,
            itemId: item.id,
            equipped: itemEntry.equipped ?? false,
          },
        });
      }
    }
  }
}

seed()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

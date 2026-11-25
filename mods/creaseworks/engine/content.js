// Every Creaseworks table (DESIGN §4-§10, ARCHITECTURE B3). Frozen plain data;
// module scope holds literals only (A2 rule 2). Numbers marked † in DESIGN are
// calibration knobs: change DESIGN.md and BALANCE.md together.

const f = Object.freeze;

export const SAVE_FORMAT = "creaseworks-save";

// §7.2 workshops: cost_n = base · GROWTH^n.
export const GROWTH = 1.16; // †
export const WORKSHOPS = f([
  f({ id: "paper-stack", name: "Paper Stack", base: 15, out: 0.05, icon: "stack" }),
  f({ id: "bone-folder", name: "Bone Folder", base: 180, out: 0.3, icon: "folder" }),
  f({ id: "scissor-stand", name: "Scissor Stand", base: 2200, out: 1.8, icon: "scissors" }),
  f({ id: "glue-pot", name: "Glue Pot", base: 26000, out: 11, icon: "pot" }),
  f({ id: "fold-bench", name: "Fold Bench", base: 310000, out: 65, icon: "bench" }),
  f({ id: "washi-vat", name: "Washi Vat", base: 3.7e6, out: 390, icon: "vat" }),
  f({ id: "flower-press", name: "Flower Press", base: 4.5e7, out: 2300, icon: "press" }),
  f({ id: "crane-loft", name: "Crane Loft", base: 5.4e8, out: 14000, icon: "loft" }),
  f({ id: "kite-tower", name: "Kite Tower", base: 6.5e9, out: 84000, icon: "tower" }),
]);

// Tier upgrades: at 10/25/50 owned, cost base × 20/200/4000, each ×2 output.
export const TIERS = f([
  f({ n: 1, at: 10, mult: 20, name: "Neat Edges" }),
  f({ n: 2, at: 25, mult: 200, name: "True Corners" }),
  f({ n: 3, at: 50, mult: 4000, name: "Master's Touch" }),
]);

// §7.3 upgrades. `fx` names the effect family; `v` its value; `req` a
// predecessor that must be bought first (chained levels).
export const UPGRADES = f([
  // Tools (hand)
  f({ id: "crisp-corners", seg: "tools", name: "Crisp Corners", cost: 100, fx: "hand", text: "hand ×2" }),
  f({ id: "bone-tip-nail", seg: "tools", name: "Bone-tip Nail", cost: 1500, fx: "hand", text: "hand ×2" }),
  f({ id: "valley-fold", seg: "tools", name: "Valley Fold", cost: 40000, fx: "hand", text: "hand ×2" }),
  f({ id: "mountain-fold", seg: "tools", name: "Mountain Fold", cost: 1.2e6, fx: "hand", text: "hand ×2" }),
  f({ id: "squash-fold", seg: "tools", name: "Squash Fold", cost: 4e7, fx: "hand", text: "hand ×2" }),
  f({ id: "petal-fold", seg: "tools", name: "Petal Fold", cost: 1.5e9, fx: "hand", text: "hand ×2" }),
  f({ id: "thousandth-fold", seg: "tools", name: "Thousandth Fold", cost: 6e10, fx: "hand", text: "hand ×2" }),
  f({ id: "echo-1", seg: "tools", name: "Echo Crease I", cost: 2000, fx: "echo", v: 0.06, text: "echo 3 % → 6 %" }), // †
  f({ id: "echo-2", seg: "tools", name: "Echo Crease II", cost: 80000, fx: "echo", v: 0.10, req: "echo-1", text: "echo → 10 %" }),
  f({ id: "echo-3", seg: "tools", name: "Echo Crease III", cost: 4e6, fx: "echo", v: 0.18, req: "echo-2", text: "echo → 18 %" }),
  f({ id: "echo-4", seg: "tools", name: "Echo Crease IV", cost: 3e8, fx: "echo", v: 0.28, req: "echo-3", text: "echo → 28 %" }),
  f({ id: "echo-5", seg: "tools", name: "Echo Crease V", cost: 2e10, fx: "echo", v: 0.40, req: "echo-4", text: "echo → 40 %" }),
  f({ id: "steady-rhythm", seg: "tools", name: "Steady Rhythm", cost: 5000, fx: "gap", v: 1400, text: "rhythm gap 1.0 → 1.4 s" }),
  f({ id: "long-streak", seg: "tools", name: "Long Streak", cost: 250000, fx: "combo", v: 1.0, text: "streak up to ×2" }),
  f({ id: "endless-streak", seg: "tools", name: "Endless Streak", cost: 5e7, fx: "combo", v: 2.0, req: "long-streak", text: "streak up to ×3" }),
  // Folk (helpers)
  f({ id: "rice-treats", seg: "folk", name: "Rice Treats", cost: 2000, fx: "folk", text: "helpers ×1.5" }),
  f({ id: "soft-brushes", seg: "folk", name: "Soft Brushes", cost: 100000, fx: "folk", text: "helpers ×1.5" }),
  f({ id: "snug-bench", seg: "folk", name: "Snug Bench", cost: 5e6, fx: "folk", text: "helpers ×1.5" }),
  f({ id: "paper-hats", seg: "folk", name: "Paper Hats", cost: 3e8, fx: "folk", text: "helpers ×1.5" }),
  f({ id: "gold-leaf-hats", seg: "folk", name: "Gold-leaf Hats", cost: 2e10, fx: "folk", text: "helpers ×1.5" }),
  f({ id: "shared-rhythm", seg: "folk", name: "Shared Rhythm", cost: 2e6, fx: "shared", text: "In step at 20 and ×2; afterglow ×1.5" }),
  f({ id: "deep-rest", seg: "folk", name: "Deep Rest", cost: 20000, fx: "rest", v: 20, text: "full rest in 20 min" }),
  f({ id: "dreamy-rest", seg: "folk", name: "Dreamy Rest", cost: 2e6, fx: "rest", v: 12, req: "deep-rest", text: "full rest in 12 min" }),
  f({ id: "warm-hands", seg: "folk", name: "Warm Hands", cost: 500000, fx: "warm", v: 2, text: "rested helpers up to ×3" }),
  f({ id: "fledgling-wings", seg: "folk", name: "Fledgling Wings", cost: 50000, fx: "kids", v: 0.5, text: "fledglings +50 % each" }),
  f({ id: "flight-school", seg: "folk", name: "Flight School", cost: 5e6, fx: "kids", v: 0.75, req: "fledgling-wings", text: "fledglings +75 % each" }),
  f({ id: "night-shift", seg: "folk", name: "Night Shift", cost: 500000, fx: "away", v: 0.35, text: "away pay 25 % → 35 %" }),
  f({ id: "night-owl", seg: "folk", name: "Night Owl", cost: 5e7, fx: "away", v: 0.45, req: "night-shift", text: "away pay → 45 %" }),
  // Charms (boost strength)
  f({ id: "wax-seal", seg: "charms", name: "Wax Seal", cost: 10000, fx: "env", v: 1.5, text: "bundles ×1.5" }),
  f({ id: "ribbon-tie", seg: "charms", name: "Ribbon Tie", cost: 1e6, fx: "env", v: 2.0, req: "wax-seal", text: "bundles ×2" }),
  f({ id: "long-ribbon", seg: "charms", name: "Long Ribbon", cost: 100000, fx: "dur", v: 1.5, text: "boosts last ×1.5" }),
  f({ id: "longer-ribbon", seg: "charms", name: "Longer Ribbon", cost: 1e7, fx: "dur", v: 2.0, req: "long-ribbon", text: "boosts last ×2" }),
  f({ id: "brisk-charm", seg: "charms", name: "Brisk Charm", cost: 3e6, fx: "rush", v: 4, text: "Rush ×3 → ×4" }),
  f({ id: "gale-charm", seg: "charms", name: "Gale Charm", cost: 1e8, fx: "storm", v: 10, text: "Storm ×7 → ×10" }),
  // Curios (special clickables)
  f({ id: "long-crease", seg: "curios", name: "Long Crease", cost: 20000, fx: "chainK", v: 5, text: "chains of 5" }),
  f({ id: "grand-crease", seg: "curios", name: "Grand Crease", cost: 2e6, fx: "chainK", v: 7, req: "long-crease", text: "chains of 7" }),
  f({ id: "quick-creases", seg: "curios", name: "Quick Creases", cost: 200000, fx: "chainEvery", v: 12000, text: "a chain every 12 s" }),
  f({ id: "scrap-basket", seg: "curios", name: "Scrap Basket", cost: 100000, fx: "scrap", v: 2, text: "scraps ×2" }),
  f({ id: "crane-bait", seg: "curios", name: "Crane Bait", cost: 50000, fx: "crane", v: 210, text: "cranes every 210-420 s" }),
  f({ id: "crane-song", seg: "curios", name: "Crane Song", cost: 5e6, fx: "crane", v: 150, req: "crane-bait", text: "cranes every 150-300 s" }),
  f({ id: "slow-wings", seg: "curios", name: "Slow Wings", cost: 500000, fx: "craneLife", v: 20000, text: "cranes stay 20 s" }),
  f({ id: "harbour-ribbon", seg: "curios", name: "Harbour Ribbon", cost: 1e6, fx: "boat", text: "the Paper Boat sails" }),
]);

// §8 automations (on when bought).
export const AUTOMATIONS = f([
  f({ id: "mail-sorter", seg: "auto", name: "Mail Sorter", cost: 25000, text: "opens Bundles 10 s after they land" }),
  f({ id: "thrifty-fox", seg: "auto", name: "Thrifty Fox", cost: 500000, text: "buys the best-payback workshop at 4× its cost" }),
  f({ id: "boost-keeper", seg: "auto", name: "Boost Keeper", cost: 2.5e6, text: "opens a boost while you click" }),
  f({ id: "crease-helper", seg: "auto", name: "Crease Helper", cost: 5e6, text: "finishes chains at half value" }),
]);

// §9 perks by Wishes held.
export const PERKS = f([
  f({ at: 10, id: "keep-basics", text: "Keep Crisp Corners and Mail Sorter between runs" }),
  f({ at: 25, id: "head-start", text: "Start each run with 10 Paper Stacks and 5 Bone Folders" }),
  f({ at: 50, id: "crane-call", text: "Gilded cranes come 20 % sooner" }),
  f({ at: 100, id: "keep-auto", text: "Automations stay bought" }),
  f({ at: 250, id: "deep-tray", text: "Envelopes stack to ×15" }),
]);

export const PRESTIGE = f({ Lw: 6e6, firstCranes: 1000, minGain: 5, gateShare: 0.25, perWish: 0.05 }); // Lw †

export const SPECIES = f(["crane", "frog", "fox", "koi", "rabbit", "turtle", "butterfly", "whale", "owl", "boat", "mouse", "snail"]);
export const HUES = f(["vermilion", "saffron", "leaf", "teal", "sky", "violet", "plum", "slate"]);
export const NAME_A = f(["Mi", "Ko", "Pi", "Ta", "Su", "No", "Ri", "Ha", "Yu", "Fe", "Lo", "Bi", "Ka", "Mo", "Ze", "Wu"]);
export const NAME_B = f(["na", "to", "b", "ki", "ri", "mo", "sa", "ku", "ro", "n", "li", "po"]);
// §5.1: syllable pairs that make a slur, a sexualised or vulgar slang word, a
// deity's or a well-known character's name are never given (review r2-28).
// Each takes the next pair in table order (row-major, wrapping) that is not on
// this list, so a remap can never land on a listed pair.
export const NAME_SKIP = f([
  "Feto", "Haku", "Han", "Haro", "Kaki", "Kali", "Kapo", "Kato", "Kon", "Koro", "Loki",
  "Loli", "Misa", "Miku", "Mob", "Momo", "Mona", "Moro", "Nob", "Pipo", "Pito", "Riku",
  "Rin", "Rito", "Sub", "Suki", "Taki", "Tali", "Yuna", "Yuri", "Zemo", "Zero",
]);
// The 192 helper names (160 distinct), index (h >>> 8) % 16 · 12 + (h >>> 12) % 12:
// NAME_A × NAME_B with NAME_SKIP remapped (a literal, so module scope holds
// data only; a test rebuilds it from the three tables above).
export const NAMES = f([
  "Mina", "Mito", "Mib", "Miki", "Miri", "Mimo", "Miro", "Miro", "Miro", "Min", "Mili", "Mipo",
  "Kona", "Koto", "Kob", "Koki", "Kori", "Komo", "Kosa", "Koku", "Koli", "Koli", "Koli", "Kopo",
  "Pina", "Pib", "Pib", "Piki", "Piri", "Pimo", "Pisa", "Piku", "Piro", "Pin", "Pili", "Tana",
  "Tana", "Tato", "Tab", "Tari", "Tari", "Tamo", "Tasa", "Taku", "Taro", "Tan", "Tapo", "Tapo",
  "Suna", "Suto", "Suri", "Suri", "Suri", "Sumo", "Susa", "Suku", "Suro", "Sun", "Suli", "Supo",
  "Nona", "Noto", "Noki", "Noki", "Nori", "Nomo", "Nosa", "Noku", "Noro", "Non", "Noli", "Nopo",
  "Rina", "Rib", "Rib", "Riki", "Riri", "Rimo", "Risa", "Riro", "Riro", "Rili", "Rili", "Ripo",
  "Hana", "Hato", "Hab", "Haki", "Hari", "Hamo", "Hasa", "Hali", "Hali", "Hali", "Hali", "Hapo",
  "Yuto", "Yuto", "Yub", "Yuki", "Yumo", "Yumo", "Yusa", "Yuku", "Yuro", "Yun", "Yuli", "Yupo",
  "Fena", "Feb", "Feb", "Feki", "Feri", "Femo", "Fesa", "Feku", "Fero", "Fen", "Feli", "Fepo",
  "Lona", "Loto", "Lob", "Lori", "Lori", "Lomo", "Losa", "Loku", "Loro", "Lon", "Lopo", "Lopo",
  "Bina", "Bito", "Bib", "Biki", "Biri", "Bimo", "Bisa", "Biku", "Biro", "Bin", "Bili", "Bipo",
  "Kana", "Kab", "Kab", "Kari", "Kari", "Kamo", "Kasa", "Kaku", "Karo", "Kan", "Moto", "Moto",
  "Moto", "Moto", "Moki", "Moki", "Mori", "Mosa", "Mosa", "Moku", "Mon", "Mon", "Moli", "Mopo",
  "Zena", "Zeto", "Zeb", "Zeki", "Zeri", "Zesa", "Zesa", "Zeku", "Zen", "Zen", "Zeli", "Zepo",
  "Wuna", "Wuto", "Wub", "Wuki", "Wuri", "Wumo", "Wusa", "Wuku", "Wuro", "Wun", "Wuli", "Wupo",
]);

// §6.1 envelope types, rolled in this order against one PRNG draw.
export const ENVELOPES = f([
  f({ type: "bundle", chance: 0.55, name: "Bundle" }),
  f({ type: "rush", chance: 0.25, name: "Rush", baseMs: 30000, capMs: 90000 }),
  f({ type: "storm", chance: 0.10, name: "Paper Storm", baseMs: 12000, capMs: 30000 }),
  f({ type: "chorus", chance: 0.10, name: "Chorus", baseMs: 120000, capMs: 240000 }),
]);
export const BOOST_KINDS = f(["rush", "storm", "chorus", "song", "tailwind"]);
export const SEGMENTS = f(["works", "tools", "folk", "charms", "curios", "auto"]);

// Spawn slots (DESIGN §3.2): a 10×5 grid over the play field (y 28-200), each
// 30.4 × 34.4. Slot index = row·10 + col. Slot 0 is the Fresh Ream's; the
// twelve slots whose centres lie on the Sheet (cols 3-6 × rows 1-3) are left
// out, so nothing ever overlaps the Sheet.
export const SLOT = f({ cols: 10, rows: 5, w: 30.4, h: 34.4, y0: 28, ream: 0 });
export const FREE_SLOTS = f([
  1, 2, 3, 4, 5, 6, 7, 8, 9,
  10, 11, 12, 17, 18, 19,
  20, 21, 22, 27, 28, 29,
  30, 31, 32, 37, 38, 39,
  40, 41, 42, 43, 44, 45, 46, 47, 48, 49,
]);

// Every tuned constant of §4-§10 in one place (ms unless noted).
export const K = f({
  hitMinMs: 80, // ≤ 12.5 credited hand hits per second
  gapMs: 1000,
  rMax: 40,
  comboMax: 0.5,
  stepIn: 25, stepInShared: 20,
  stepMult: 1.5, stepMultShared: 2.0,
  glowMult: 1.25, glowMultShared: 1.5,
  glowPerHitMs: 6000, glowMaxMs: 20 * 60000,
  figureEvery: 8, figureMult: 5, shelfMax: 12,
  echoBase: 0.03,
  rushMult: 3, stormMult: 7,
  activeWindowMs: 30000, spawnCatchUpMs: 120000,
  chainEveryMs: 20000, chainStormMs: 4000, chainK: 3, nodeLifeMs: 10000,
  nodePay: 2, nodeWrongPay: 1, chainFinishPerNode: 3,
  scrapEveryMs: 45000, scrapLifeMs: 12000, scrapMaxLive: 3, scrapRp: 30, scrapV: 50,
  reamRp: 300, reamV: 100,
  craneFirstMs: 390000, craneLo: 300, craneLifeMs: 13000, cranePerk: 0.8,
  luckyRp: 900, luckyBank: 0.15, luckyV: 13,
  stormFromCraneMs: 15000, songMs: 60000, songCapMs: 120000,
  boatLo: 1800, boatSpread: 900, boatLifeMs: 20000, boatRp: 120, tailwindOpens: 3, tailwindMs: 10 * 60000,
  calmLife: 2,
  helperFlat: 0.3, helperRw: 0.04, folkMult: 1.5, knee: 4, crowdExp: 0.07, // exponent †
  restFullMin: 30, restMax: 1, warmMs: 20 * 60000, kidBonus: 0.25, kidMax: 4,
  thanksMs: 5 * 60000, thanksWindowMs: 5 * 60000, thanksMult: 1.5,
  songMult: 3, chorusMult: 2,
  unitRefillMs: 12 * 60000, unitPane: 1, unitKid: 0.5, // r3-24: a token bucket per budget, at most 1 share, refilled 1 per 12 min
  envCap: 9, envCapPerk: 15, envRp: 45, envV: 75, stackStep: 0.25, extendShare: 0.25,
  awayAfterMs: 60000, awayCapMs: 8 * 3600000, capShareLiveMs: 5 * 60000, awayF: 0.25, // awayF †
  awayCardMs: 5 * 60000, potAutoMs: 10 * 60000, clockBackMs: 5000,
  staleMs: 60000, staleCreditMs: 8 * 3600000,
  busyMs: 30 * 60000,
  mailSorterMs: 10000, foxEveryMs: 10000, foxBankMult: 4, keeperHandMs: 60000, creaseHelperAt: 0.8, creaseHelperValue: 0.5,
  kidAlbumMs: 30 * 86400000, writerPruneMs: 30 * 86400000,
  albumKeep: 200, kidAlbumKeep: 200, // R13: full Album records kept; older ones are compacted / folded
  // R13, r3-04: compact Album records kept one by one; beyond keep + batch the
  // oldest are merged into one archive entry per 30 days they left in
  albumCompactKeep: 10000, albumArchiveBatch: 1000, albumArchiveMs: 30 * 86400000,
  // R13, r5-07: the whole save is held under saveBudget (estimated bytes, far
  // under herdr's 1 MiB write limit) by archiving more compact records when the
  // present roster is large. Per-record estimates (UTF-8 bytes as written):
  // a present helper's fields without its strings (which are counted exactly),
  // a full Album record or archive entry, a packed entry (+ fledgling totals,
  // + a name of its own), an envelope, and everything outside helpers/envelopes.
  saveBudget: 896 * 1024, saveBytesPresent: 560, saveBytesGone: 416,
  saveBytesCompact: 42, saveBytesCompactKids: 14, saveBytesEnvelope: 80, saveBytesRest: 16 * 1024,
  pileCount: 12,
  garlandHelpers: 16, garlandsMax: 50,
  noticesMax: 12, noteLifeMs: 60000,
  titleMax: 80,
});

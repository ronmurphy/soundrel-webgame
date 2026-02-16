import { shuffle } from './dungeon-generator.js';

export const SUITS = { HEARTS: '♥', DIAMONDS: '♦', CLUBS: '♣', SPADES: '♠', SKULLS: '💀', MENACES: '👺' };

export const ITEMS_SHEET_COUNT = 10;
export const WEAPON_SHEET_COUNT = 10;

export const CURSED_ITEMS = [
    { id: 'cursed_blade', name: "Bloodthirst Blade", cost: 66, type: 'weapon', val: 12, suit: '♦', desc: "12 DMG. Drains 1 HP per room.", isCursed: true },
    { id: 'cursed_ring', name: "Ring of Burden", cost: 66, type: 'passive', desc: "+10 Max HP. Cannot Flee.", isCursed: true }
];

export const ARMOR_DATA = [
    { id: 0, name: "Studded Gloves", ap: 2, cost: 25, slot: "hands", desc: "Light hand protection." },
    { id: 1, name: "Articulated Gauntlets", ap: 5, cost: 50, slot: "hands", desc: "Heavy plated hand protection." },
    { id: 2, name: "Iron Pot Helm", ap: 5, cost: 45, slot: "head", desc: "Solid iron headgear." },
    { id: 3, name: "Heavy Greaves", ap: 5, cost: 45, slot: "legs", desc: "Thick leg armor." },
    { id: 4, name: "Padded Gambeson", ap: 1, cost: 25, slot: "chest", desc: "Basic cloth armor." },
    { id: 5, name: "Reinforced Leather", ap: 2, cost: 30, slot: "chest", desc: "Hardened leather chestpiece." },
    { id: 6, name: "Chainmail Hauberk", ap: 3, cost: 40, slot: "chest", desc: "Interlinked metal rings." },
    { id: 7, name: "Steel Breastplate", ap: 4, cost: 55, slot: "chest", desc: "Solid steel chest protection." },
    { id: 8, name: "Gothic Plate", ap: 5, cost: 75, slot: "chest", desc: "Masterwork full plate." }
];

export const ITEM_DATA = [
    { id: 0, name: "Volatile Bomb", cost: 30, type: 'active', desc: "Deal weapon dmg to random enemy." },
    { id: 1, name: "Spectral Lantern", cost: 50, type: 'passive', desc: "Permanent Gold Light." },
    { id: 2, name: "Skeleton Key", cost: 35, type: 'active', desc: "Avoid room (even if last avoided)." },
    { id: 3, name: "Leather Map", cost: 40, type: 'passive', desc: "Reveal all room locations." },
    { id: 4, name: "Purple Hourglass", cost: 30, type: 'active', desc: "Redraw current room." },
    { id: 5, name: "Protective Herbs", cost: 25, type: 'passive', desc: "+5 HP from Bonfires." },
    { id: 6, name: "Silver Mirror", cost: 60, type: 'passive', desc: "Survive fatal blow once." },
    { id: 7, name: "Music Box", cost: 35, type: 'active', desc: "-2 to all monsters in room." },
    { id: 8, name: "Iron-Bound Tome", cost: 50, type: 'passive', desc: "+2 Soul Coins per kill." }
];

export const CLASS_DATA = {
    knight: {
        name: "Knight",
        desc: "A stalwart defender. Starts with a Rusty Sword and basic armor.",
        hp: 20,
        items: [{ type: 'weapon', id: 'rusty_sword', val: 4, suit: '♦', name: "Rusty Sword" }, { type: 'armor', id: 0 }],
        icon: { type: 'class-icon', val: 0 }
    },
    rogue: {
        name: "Rogue",
        desc: "Cunning and greedy. Starts with a Skeleton Key and a Tome for extra coins.",
        hp: 20,
        items: [{ type: 'item', id: 2 }, { type: 'item', id: 8 }],
        icon: { type: 'class-icon', val: 1 }
    },
    occultist: {
        name: "Occultist",
        desc: "Seeker of forbidden knowledge. Starts with the Spectral Lantern but has less health.",
        hp: 15,
        items: [{ type: 'item', id: 1 }],
        icon: { type: 'class-icon', val: 2 }
    }
};

// --- CORE GAME STATE ---
export const game = {
    hp: 20, maxHp: 20,
    slain: 0,
    rooms: [],
    currentRoomIdx: 0,
    moves: 0,
    lastAvoided: false,
    potionsUsedThisTurn: false,
    sex: 'm',
    classId: 'knight',
    mode: 'checkpoint',
    activeRoom: null,
    chosenCount: 0,
    combatCards: [],
    slainStack: [],
    carryCard: null,
    combatBusy: false,
    soulCoins: 0,
    equipment: { head: null, chest: null, hands: null, legs: null, weapon: null },
    backpack: [],
    hotbar: [],
    ap: 0,
    maxAp: 0,
    bonfireUsed: false,
    merchantUsed: false,
    pendingPurchase: null,
    isBossFight: false,
    torchCharge: 20,
    anvil: [null, null],
    currentTrack: null,
    deck: []
};

export function getDisplayVal(v) {
    const map = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
    return map[v] || v;
}

export function getUVForCell(cellIdx, totalCells = 9) {
    return { u: cellIdx / totalCells, v: 0 };
}

export function getAssetData(type, value, suit, extra) {
    let file = 'block.png';
    let v = value;
    let s = suit;

    if (type === 'monster') {
        if (suit === SUITS.CLUBS) file = 'club.png';
        else if (suit === SUITS.SPADES) file = 'spade.png';
        else if (suit === SUITS.SKULLS) file = 'skull.png';
        else if (suit === SUITS.MENACES) file = 'menace.png';
        else file = 'club.png';
    }
    else if (type === 'weapon' || type === 'passive') {
        if (value === 'cursed_blade') file = 'diamond.png';
        else if (value === 'cursed_ring') file = 'items.png';
        else {
            if (game.classId === 'occultist' && type === 'weapon') file = 'occultist.png';
            else file = 'diamond.png';
        }
    }
    else if (type === 'class-icon') file = 'classes.png';
    else if (type === 'potion') file = 'heart.png';
    else if (type === 'block') file = 'block.png';
    else if (type === 'bonfire') file = 'rest_m_large.png';
    else if (type === 'gift' && extra) {
        if (extra.type === 'armor') {
            file = 'armor.png';
            v = extra.id;
        } else {
            if (extra.type === 'weapon') {
                if (extra.id === 'cursed_blade') file = 'diamond.png';
                else file = (game.classId === 'occultist') ? 'occultist.png' : 'diamond.png';
            } else {
                file = 'heart.png';
            }
            v = extra.val; s = extra.suit;
        }
    }
    else if (type === 'armor') { file = 'armor.png'; v = value; }
    else if (type === 'item') { file = 'items.png'; v = value; }

    let cellIdx = 0;
    let sheetCount = 9;
    if (file === 'items.png') sheetCount = ITEMS_SHEET_COUNT;
    if (file === 'diamond.png') sheetCount = WEAPON_SHEET_COUNT;

    if (type === 'block') { cellIdx = value % 9; }
    else if (type === 'bonfire') { cellIdx = 0; }
    else if (type === 'armor' || type === 'item') {
        if (file === 'items.png') sheetCount = ITEMS_SHEET_COUNT;
        cellIdx = value;
        if (value === 'cursed_ring') cellIdx = 9;
    } else if (type === 'weapon' || type === 'class-icon') {
        if (value === 'cursed_blade') cellIdx = 9;
        else if (type === 'weapon' && game.classId === 'occultist' && value > 10) cellIdx = value - 6;
        else cellIdx = Math.max(0, value - (type === 'weapon' ? 2 : 0));
    } else if (type === 'gift' && extra && extra.type === 'armor') {
        cellIdx = v;
    } else if (type === 'gift' && extra && extra.type === 'weapon') {
        if (extra.id === 'cursed_blade') cellIdx = 9;
        else if (game.classId === 'occultist' && v > 10) cellIdx = v - 6;
        else cellIdx = Math.max(0, v - 2);
    } else {
        if (v <= 3) cellIdx = 0;
        else if (v <= 5) cellIdx = 1;
        else if (v <= 7) cellIdx = 2;
        else if (v <= 9) cellIdx = 3;
        else if (v === 10) cellIdx = 4;
        else if (v === 11) cellIdx = 5;
        else if (v === 12) cellIdx = 6;
        else if (v === 13) cellIdx = 7;
        else if (v === 14) cellIdx = 8;
        else cellIdx = 0;
    }
    const isStrip = !file.includes('rest');
    return { file, uv: getUVForCell(cellIdx, sheetCount), isStrip, sheetCount };
}

export function getSpellName(v) {
    const names = {
        2: "Fire Bolt", 3: "Ice Dagger", 4: "Poison Dart",
        5: "Lightning", 6: "Ball Lightning", 7: "Fireball",
        8: "Abyssal Rift", 9: "Comet Fall", 10: "Eldritch Annihilation",
        11: "Fireball", 12: "Abyssal Rift", 13: "Comet Fall", 14: "Eldritch Annihilation"
    };
    return names[v] || "Unknown Spell";
}

export function getMonsterName(v, suit) {
    if (suit === SUITS.SKULLS) {
        if (v <= 3) return 'Skeleton';
        if (v <= 5) return 'Zombie';
        if (v <= 7) return 'Ghost';
        if (v <= 9) return 'Skeletal Warrior';
        if (v === 10) return 'Ghoul';
        if (v === 11) return 'Wight';
        if (v === 12) return 'Wraith';
        if (v === 13) return 'Vampire';
        if (v === 14) return 'Lich Lord';
    } else if (suit === SUITS.MENACES) {
        if (v <= 3) return 'Kobold';
        if (v <= 5) return 'Goblin';
        if (v <= 7) return 'Gremlin';
        if (v <= 9) return 'Hobgoblin';
        if (v === 10) return 'Orc';
        if (v === 11) return 'Gnoll';
        if (v === 12) return 'Lizard-man';
        if (v === 13) return 'Yuan-ti';
        if (v === 14) return 'Bugbear Chief';
    } else {
        if (v <= 3) return 'Shadow Creeper';
        if (v <= 5) return 'Graveling';
        if (v <= 7) return 'Rat-Bat';
        if (v <= 9) return 'Spined Horror';
        if (v === 10) return 'Grue';
        if (v === 11) return 'Jack of Spite';
        if (v === 12) return 'Queen of Sorrow';
        if (v === 13) return 'King of Ruin';
        if (v === 14) return 'Primeval Ace';
    }
    return `Monster (${v})`;
}

export function createDeck() {
    let multiplier = 1;
    if (game.floor >= 4) multiplier = 2;
    if (game.floor >= 7) multiplier = 3;

    let monsterSuits = [SUITS.CLUBS, SUITS.MENACES];
    if (game.floor >= 4) monsterSuits = [SUITS.SPADES, SUITS.SKULLS];
    if (game.floor >= 7) monsterSuits = [SUITS.MENACES, SUITS.SKULLS];

    const deck = [];
    for (let i = 0; i < multiplier; i++) {
        monsterSuits.forEach(suit => {
            for (let v = 2; v <= 14; v++) {
                deck.push({ suit, val: v, type: 'monster', name: getMonsterName(v, suit) });
            }
        });
        for (let v = 2; v <= 10; v++) {
            if (game.classId === 'occultist') {
                deck.push({ suit: SUITS.DIAMONDS, val: v, type: 'weapon', name: getSpellName(v), isSpell: true });
            } else {
                deck.push({ suit: SUITS.DIAMONDS, val: v, type: 'weapon', name: `Weapon lv.${v}` });
            }
        }
        for (let v = 2; v <= 10; v++) {
            deck.push({ suit: SUITS.HEARTS, val: v, type: 'potion', name: `HP Incense ${v}` });
        }
    }
    return shuffle(deck);
}

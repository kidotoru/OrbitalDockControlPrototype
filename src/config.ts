import type { Size } from './station';

/**
 * ゲームバランス用の数値はすべてここに集約する。
 * 単位：リソースは u（ユニット）、クレジットは $、時間は秒。
 */
export const ECONOMY = {
  /** ステーションの初期クレジット */
  startCredit: 500,
  /** ステーションの初期在庫 */
  startStock: 300,
  /** ステーションの貯蔵上限 */
  capacity: 10000,
  /** ステーション自身のリソース消費（u/秒）。在庫が 0 になるとゲームオーバー */
  consumptionPerSec: 0.1,
  /** サプライヤーからの買い取り単価の範囲（機体ごとにランダム） */
  buyPrice: [0.5, 0.7] as [number, number],
  /** コンシューマーへの販売単価：評判 0 で min、100 で max（その間は比例） */
  sellPriceMin: 1.0,
  sellPriceMax: 5.0,
  /** 在庫・クレジット・空き容量が尽きてから、取引を打ち切るまでの猶予 */
  stallGrace: 3,
  /** 在庫表示を警告色にするしきい値（u）。0.1u/秒の消費で 100u ≒ 1000秒、250u ≒ 2500秒 */
  lowStockBad: 100,
  lowStockWarn: 250,
};

export const SHIP_SIZE: Record<Size, { cargo: number; rate: number; patience: number; length: number }> = {
  //    積載量(u)     移送速度(u/秒)  待機の限界(秒)  機体の長さ
  S: { cargo: 60, rate: 8, patience: 45, length: 2.6 },
  M: { cargo: 150, rate: 12, patience: 55, length: 4 },
  L: { cargo: 300, rate: 18, patience: 70, length: 6 },
};
/** 積載量のばらつき（±割合） */
export const CARGO_JITTER = 0.15;

export const REPUTATION = {
  start: 20,
  /** 予定量どおりに取引できた */
  fullTrade: +1,
  /** 部分取引で出発（不足量の割合に比例。最大値） */
  partialTrade: -6,
  /** 待ちきれずに離脱（戦略的に待たせて帰すこともあるので、部分取引より軽め） */
  leave: -1,
  /** 衝突事故 */
  collision: -15,
};

/** 評判に応じた販売単価（$/u）。取引開始時に確定する */
export function sellPrice(reputation: number): number {
  const p = ECONOMY.sellPriceMin + (ECONOMY.sellPriceMax - ECONOMY.sellPriceMin) * (reputation / 100);
  return Math.round(p * 100) / 100;
}

/** 衝突事故の修理費 */
export const COLLISION_COST = 200;

/**
 * 出現間隔（秒）。時間とともに短くなり、評判が高いほど短くなる。
 * 評判 100 で 0.6 倍、評判 0 で 1.4 倍。
 */
export function spawnInterval(time: number, reputation: number): number {
  const base = Math.max(7, 16 - time / 40);
  return base * (1.4 - 0.8 * (reputation / 100));
}

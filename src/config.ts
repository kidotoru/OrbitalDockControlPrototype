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
  capacity: 1000,
  /** ステーションの運用費（$/秒）。何もしないとクレジットが減っていく */
  upkeepPerSec: 0.5,
  /** サプライヤーからの買い取り単価の範囲（機体ごとにランダム） */
  buyPrice: [0.7, 0.8] as [number, number],
  /** コンシューマーへの販売単価 */
  sellPrice: 1.0,
  /**
   * 運転資金。買い取りではこの額を下回るまでクレジットを使わない。
   * 在庫を抱えたまま運用費で即破産するのを防ぎ、売って立て直す猶予を作る。
   */
  reserve: 150,
  /** 在庫・クレジット・空き容量が尽きてから、取引を打ち切るまでの猶予 */
  stallGrace: 3,
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
  start: 70,
  /** 予定量どおりに取引できた */
  fullTrade: +1,
  /** 部分取引で出発（不足量の割合に比例。最大値） */
  partialTrade: -6,
  /** 待ちきれずに離脱 */
  leave: -8,
  /** 衝突事故 */
  collision: -15,
};

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

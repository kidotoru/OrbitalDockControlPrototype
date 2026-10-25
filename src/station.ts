import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

export type Size = 'S' | 'M' | 'L';
export const SIZE_RANK: Record<Size, number> = { S: 0, M: 1, L: 2 };
export type PortState = 'free' | 'reserved' | 'occupied';

export interface Port {
  id: string;
  size: Size;
  /** ドッキング面の中心（ワールド座標） */
  position: THREE.Vector3;
  /** ポートの外向き法線 */
  normal: THREE.Vector3;
  state: PortState;
  shipId: number | null;
  ring: THREE.Mesh;
  ringMat: THREE.MeshBasicMaterial;
  hit: THREE.Mesh;
  labelEl: HTMLDivElement;
}

interface PortDef { id: string; size: Size; pos: [number, number, number]; n: [number, number, number] }

const PORT_DEFS: PortDef[] = [
  { id: 'A1', size: 'L', pos: [16, 3, 0], n: [1, 0, 0] },
  { id: 'A2', size: 'M', pos: [-16, 3, 0], n: [-1, 0, 0] },
  { id: 'B1', size: 'M', pos: [0, -3, 16], n: [0, 0, 1] },
  { id: 'B2', size: 'S', pos: [0, -3, -16], n: [0, 0, -1] },
  { id: 'C1', size: 'L', pos: [0, 9.5, 0], n: [0, 1, 0] },
  { id: 'C2', size: 'S', pos: [0, -9.5, 0], n: [0, -1, 0] },
];

const MODULE_R: Record<Size, number> = { S: 1.2, M: 1.7, L: 2.2 };
const RING_R: Record<Size, number> = { S: 1.4, M: 2.0, L: 2.6 };

export function buildStation(): { group: THREE.Group; ports: Port[] } {
  const group = new THREE.Group();
  const hull = new THREE.MeshStandardMaterial({ color: 0xd9dde3, metalness: 0.35, roughness: 0.55 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x6b7280, metalness: 0.5, roughness: 0.5 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 0.8, roughness: 0.35 });
  const solar = new THREE.MeshStandardMaterial({
    color: 0x1b2a6b, metalness: 0.6, roughness: 0.3, emissive: 0x0a1030, side: THREE.DoubleSide,
  });

  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, 0, rz);
    group.add(m);
    return m;
  };

  // コアモジュール
  add(new THREE.CylinderGeometry(3, 3, 16, 28), hull, 0, 0, 0);
  add(new THREE.CylinderGeometry(3.25, 3.25, 1, 28), gold, 0, 3, 0);
  add(new THREE.CylinderGeometry(3.25, 3.25, 1, 28), gold, 0, -3, 0);
  // 上下ポート用カラー
  add(new THREE.CylinderGeometry(MODULE_R.L, MODULE_R.L, 1.5, 20), hull, 0, 8.75, 0);
  add(new THREE.CylinderGeometry(MODULE_R.S, MODULE_R.S, 1.5, 20), hull, 0, -8.75, 0);

  // X方向アーム（y=3）
  add(new THREE.BoxGeometry(10, 1.3, 1.3), dark, 8, 3, 0);
  add(new THREE.BoxGeometry(10, 1.3, 1.3), dark, -8, 3, 0);
  add(new THREE.CylinderGeometry(MODULE_R.L, MODULE_R.L, 3, 20), hull, 14.5, 3, 0, 0, Math.PI / 2);
  add(new THREE.CylinderGeometry(MODULE_R.M, MODULE_R.M, 3, 20), hull, -14.5, 3, 0, 0, Math.PI / 2);
  // Z方向アーム（y=-3）
  add(new THREE.BoxGeometry(1.3, 1.3, 10), dark, 0, -3, 8);
  add(new THREE.BoxGeometry(1.3, 1.3, 10), dark, 0, -3, -8);
  add(new THREE.CylinderGeometry(MODULE_R.M, MODULE_R.M, 3, 20), hull, 0, -3, 14.5, Math.PI / 2);
  add(new THREE.CylinderGeometry(MODULE_R.S, MODULE_R.S, 3, 20), hull, 0, -3, -14.5, Math.PI / 2);

  // 太陽電池パドル
  for (const sx of [7.5, -7.5]) {
    add(new THREE.BoxGeometry(0.35, 15, 0.35), dark, sx, 3, 0);
    add(new THREE.BoxGeometry(0.08, 5.5, 5), solar, sx, 7.6, 0);
    add(new THREE.BoxGeometry(0.08, 5.5, 5), solar, sx, -1.6, 0);
  }
  // ラジエーター
  add(new THREE.BoxGeometry(5, 0.08, 2.2), hull, 0, 5.5, 4.8);
  add(new THREE.BoxGeometry(5, 0.08, 2.2), hull, 0, 5.5, -4.8);

  const ports: Port[] = PORT_DEFS.map((d) => {
    const position = new THREE.Vector3(...d.pos);
    const normal = new THREE.Vector3(...d.n);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x4ade80, transparent: true, opacity: 0.9 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(RING_R[d.size], 0.16, 10, 40), ringMat);
    ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    ring.position.copy(position).addScaledVector(normal, 0.08);
    group.add(ring);

    const hit = new THREE.Mesh(
      new THREE.SphereGeometry(RING_R[d.size] + 1.6, 12, 8),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false }),
    );
    hit.position.copy(position).addScaledVector(normal, 1);
    hit.userData.portId = d.id;
    group.add(hit);

    const labelEl = document.createElement('div');
    labelEl.className = 'port-label free';
    labelEl.innerHTML = `<b>${d.id}</b><span>${d.size}</span>`;
    labelEl.dataset.portId = d.id;
    const label = new CSS2DObject(labelEl);
    label.position.copy(position).addScaledVector(normal, 3.2);
    group.add(label);

    return { id: d.id, size: d.size, position, normal, state: 'free', shipId: null, ring, ringMat, hit, labelEl };
  });

  return { group, ports };
}

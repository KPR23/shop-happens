import * as THREE from "three";
import { PRODUCT_TYPES } from "@shop/shared";

export interface ProductLook {
  name: string;
  color: number;
  /** width, height, depth in metres */
  size: [number, number, number];
}

export const PRODUCTS: ProductLook[] = [
  { name: "Cereal", color: 0xf5b82e, size: [0.28, 0.4, 0.1] },
  { name: "Milk", color: 0x4a90e2, size: [0.14, 0.3, 0.14] },
  { name: "Soup can", color: 0xd64545, size: [0.13, 0.15, 0.13] },
  { name: "Pasta", color: 0xe8d9a0, size: [0.2, 0.3, 0.08] },
  { name: "Juice", color: 0xf28c28, size: [0.14, 0.28, 0.14] },
  { name: "Chocolate", color: 0x7b4a2d, size: [0.22, 0.03, 0.11] },
  { name: "Tea", color: 0x3fa66b, size: [0.14, 0.2, 0.09] },
  { name: "Soap", color: 0xb06ad9, size: [0.16, 0.08, 0.1] },
];
if (PRODUCTS.length !== PRODUCT_TYPES) throw new Error("PRODUCTS must match PRODUCT_TYPES");

/** A simple boxy product with a white label stripe and a dark barcode patch on the bottom-facing side. */
export function makeProduct(type: number): THREE.Group {
  const look = PRODUCTS[type % PRODUCTS.length];
  const g = new THREE.Group();
  const [w, h, d] = look.size;
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: look.color, roughness: 0.6 }));
  const label = new THREE.Mesh(new THREE.BoxGeometry(w * 1.02, h * 0.3, d * 1.02), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 }));
  const code = new THREE.Mesh(new THREE.BoxGeometry(w * 0.5, 0.004, d * 0.5), new THREE.MeshBasicMaterial({ color: 0x111111 }));
  code.position.y = -h / 2 - 0.001;
  g.add(body, label, code);
  g.position.y = h / 2;
  const holder = new THREE.Group();
  holder.add(g);
  holder.userData.height = h;
  return holder;
}

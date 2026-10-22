import { schema, t, type SchemaType } from "@colyseus/schema";

export const PlayerSchema = schema(
  {
    id: t.string(),
    name: t.string(),
    colorIndex: t.uint8(),
    x: t.float32(),
    z: t.float32(),
    rot: t.float32(),
    heldBoxId: t.string(),
  },
  "Player",
);
export type PlayerSchema = SchemaType<typeof PlayerSchema>;

export const BoxSchema = schema(
  {
    id: t.string(),
    x: t.float32(),
    z: t.float32(),
    state: t.string(),
    heldBy: t.string(),
    progress: t.float32(),
    kind: t.uint8(),
  },
  "Box",
);
export type BoxSchema = SchemaType<typeof BoxSchema>;

export const ShopState = schema(
  {
    players: t.map(PlayerSchema),
    boxes: t.map(BoxSchema),
    delivered: t.uint16(),
    target: t.uint16(),
    phase: t.string(),
  },
  "ShopState",
);
export type ShopState = SchemaType<typeof ShopState>;

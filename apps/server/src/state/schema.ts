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
    action: t.string(),
    actionProgress: t.float32(),
    away: t.boolean(),
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
    type: t.string(),
    units: t.uint8(),
  },
  "Box",
);
export type BoxSchema = SchemaType<typeof BoxSchema>;

export const FixtureSchema = schema({ id: t.string(), stock: t.uint16() }, "Fixture");
export type FixtureSchema = SchemaType<typeof FixtureSchema>;

export const CustomerSchema = schema(
  {
    id: t.string(),
    x: t.float32(),
    z: t.float32(),
    rot: t.float32(),
    state: t.string(),
    items: t.uint8(),
    patience: t.float32(),
    skin: t.uint8(),
    slot: t.int8(),
  },
  "Customer",
);
export type CustomerSchema = SchemaType<typeof CustomerSchema>;

export const ShopState = schema(
  {
    players: t.map(PlayerSchema),
    boxes: t.map(BoxSchema),
    fixtures: t.map(FixtureSchema),
    customers: t.map(CustomerSchema),
    money: t.int32(),
    day: t.uint16(),
    phase: t.string(),
    phaseLeft: t.float32(),
    clock: t.float32(),
    vanState: t.string(),
    vanDriver: t.string(),
    vanLeft: t.float32(),
    hands: t.uint8(),
    deal: t.uint8(),
    traffic: t.uint8(),
    earned: t.int32(),
    served: t.uint16(),
    lost: t.uint16(),
  },
  "ShopState",
);
export type ShopState = SchemaType<typeof ShopState>;

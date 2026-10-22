import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { ROOM_NAME } from "@shop/shared";
import { ShopRoom } from "./rooms/ShopRoom";

const port = Number(process.env.PORT ?? 2567);

const server = new Server({ transport: new WebSocketTransport(), greet: false });
server.define(ROOM_NAME, ShopRoom);
await server.listen(port);
console.log(`[shop-happens] server listening on ws://localhost:${port}`);

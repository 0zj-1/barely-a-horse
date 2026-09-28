import { ROOM } from '@bah/shared';
import { makeRoomCode } from './ids';
import { Room } from './room';

/** All rooms of the Node server (on Cloudflare, each room is its own Durable Object). */
export class RoomRegistry {
  private rooms = new Map<string, Room>();

  constructor() {
    setInterval(() => this.cleanup(), 5_000).unref();
  }

  create(): Room {
    let code: string;
    do code = makeRoomCode();
    while (this.rooms.has(code));
    const room = new Room(code);
    room.emptySince = Date.now(); // until someone joins
    this.rooms.set(code, room);
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.trim().toUpperCase());
  }

  private cleanup() {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      if (room.players.size === 0 && room.emptySince !== null && now - room.emptySince > ROOM.emptyRoomTtlMs) {
        room.dispose();
        this.rooms.delete(code);
      }
    }
  }
}

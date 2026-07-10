import type { IncomingMessage, ServerResponse } from "node:http";
import { handleKanjiApiRequest } from "../src/server/kanjiApi";

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await handleKanjiApiRequest(req, res);
}

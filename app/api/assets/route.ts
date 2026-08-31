import assetsController from "@/src/server/controllers/assets";
import { NextRequest } from "next/server";

export const GET = async (request: NextRequest) => {
  return assetsController(request);
};

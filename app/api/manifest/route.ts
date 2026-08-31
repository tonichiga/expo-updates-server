import manifestController from "@/src/server/controllers/manifest";
import { NextRequest } from "next/server";

export const GET = async (request: NextRequest) => {
  return manifestController(request);
};

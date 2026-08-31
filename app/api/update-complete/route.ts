import updateCompleteController from "@/src/server/controllers/update-complete";
import { NextRequest } from "next/server";

export const POST = async (request: NextRequest) => {
  return updateCompleteController(request);
};

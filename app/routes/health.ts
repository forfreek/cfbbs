import { getHealthPayload } from "@/modules/health";

export function loader() {
  return Response.json(getHealthPayload());
}

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { unauthenticated } from "../shopify.server";
import { getMasterShop } from "../services/shop.server";
import { runFullSync } from "../services/sync.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  return json({ message: "Use POST to trigger sync" });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const secret = request.headers.get("x-cron-secret");
  if (secret !== process.env.CRON_SECRET) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const masterShop = await getMasterShop();
  if (!masterShop) {
    return json({ error: "Master shop not configured" }, { status: 400 });
  }

  const { admin } = await unauthenticated.admin(masterShop.myshopifyDomain);
  const result = await runFullSync(admin);

  return json(result);
};

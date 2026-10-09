import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate, unauthenticated } from "../shopify.server";
import { getShopByDomain } from "../services/shop.server";
import { getInventoryItemById, pushStockToChannels } from "../services/inventory.server";

interface InventoryLevelPayload {
  inventory_item_id: number;
  location_id: number;
  available: number;
  updated_at: string;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  const payload: InventoryLevelPayload = await request.json();

  console.log(`Received ${topic} webhook for ${shop}`);

  const masterShop = await getShopByDomain(shop);
  if (!masterShop || !masterShop.isMasterChannel) {
    // Only push stock when master store inventory changes
    return new Response();
  }

  const { admin } = await unauthenticated.admin(shop);

  const inventoryItem = await getInventoryItemById(
    admin,
    `gid://shopify/InventoryItem/${payload.inventory_item_id}`,
  );

  if (!inventoryItem?.sku) {
    return new Response();
  }

  await pushStockToChannels(inventoryItem.sku, payload.available);

  return new Response();
};

import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate, unauthenticated } from "../shopify.server";
import { getShopByDomain, getMasterShop } from "../services/shop.server";
import { adjustInventory, getVariantInventoryDetails } from "../services/inventory.server";
import prisma from "../db.server";

interface OrderLineItem {
  sku?: string;
  quantity: number;
}

interface OrderPayload {
  id: number;
  cancelled_at?: string | null;
  line_items: OrderLineItem[];
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  const payload: OrderPayload = await request.json();

  console.log(`Received ${topic} webhook for ${shop}`);

  const channelShop = await getShopByDomain(shop);
  if (!channelShop || channelShop.isMasterChannel) {
    return new Response();
  }

  // Only handle cancelled orders for now
  if (!payload.cancelled_at) {
    return new Response();
  }

  const masterShop = await getMasterShop();
  if (!masterShop) {
    console.warn("No master shop configured");
    return new Response();
  }

  const { admin } = await unauthenticated.admin(masterShop.myshopifyDomain);

  for (const item of payload.line_items) {
    if (!item.sku) continue;

    const mappings = await prisma.productMapping.findMany({
      where: { sku: item.sku },
      include: { shop: true },
    });

    const masterMapping = mappings.find((m) => m.shop.isMasterChannel);
    if (!masterMapping?.masterVariantId) continue;

    const details = await getVariantInventoryDetails(admin, masterMapping.masterVariantId);
    if (!details?.inventoryItem?.tracked) continue;

    const level = details.inventoryItem.inventoryLevels.edges[0]?.node;
    if (!level) continue;

    await adjustInventory(
      admin,
      details.inventoryItem.id,
      level.location.id,
      item.quantity,
      "correction",
      `order_cancelled:${payload.id}`,
    );

    await prisma.inventoryLog.create({
      data: {
        shopId: channelShop.id,
        sku: item.sku,
        quantityChange: item.quantity,
        reason: "channel_order_cancelled",
        orderId: payload.id.toString(),
      },
    });
  }

  return new Response();
};

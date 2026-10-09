import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate, unauthenticated } from "../shopify.server";
import { getShopByDomain, getMasterShop } from "../services/shop.server";
import { decreaseMasterStockForChannelOrder } from "../services/inventory.server";

interface OrderLineItem {
  sku?: string;
  quantity: number;
  variant_id?: number;
  variant_title?: string;
}

interface OrderPayload {
  id: number;
  name?: string;
  line_items: OrderLineItem[];
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  const payload: OrderPayload = await request.json();

  console.log(`Received ${topic} webhook for ${shop}`);

  const channelShop = await getShopByDomain(shop);
  if (!channelShop) {
    console.warn(`Shop ${shop} is not registered`);
    return new Response();
  }

  // Only process orders from connected sales channels, not the master store
  if (channelShop.isMasterChannel) {
    return new Response();
  }

  const masterShop = await getMasterShop();
  if (!masterShop) {
    console.warn("No master shop configured");
    return new Response();
  }

  const { admin } = await unauthenticated.admin(masterShop.myshopifyDomain);

  const lineItems = payload.line_items.map((item) => ({
    sku: item.sku,
    quantity: item.quantity,
    variantId: item.variant_id ? `gid://shopify/ProductVariant/${item.variant_id}` : undefined,
  }));

  await decreaseMasterStockForChannelOrder(
    admin,
    channelShop.id,
    payload.id.toString(),
    lineItems,
  );

  return new Response();
};

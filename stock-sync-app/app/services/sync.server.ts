import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { getMasterShop, getConnectedChannels } from "./shop.server";
import {
  getVariantInventoryDetails,
  setInventoryOnHand,
  adjustInventory,
} from "./inventory.server";

interface SyncResult {
  stockUpdated: number;
  stockErrors: string[];
  ordersProcessed: number;
  orderErrors: string[];
}

async function syncMasterStockToChannels(
  masterAdmin: AdminApiContext,
): Promise<{ updated: number; errors: string[] }> {
  const channels = await getConnectedChannels();
  if (channels.length === 0) {
    return { updated: 0, errors: [] };
  }

  const masterResponse = await masterAdmin.graphql(
    `#graphql
    query GetAllMasterVariants($first: Int!) {
      productVariants(first: $first) {
        edges {
          node {
            id
            sku
            inventoryItem {
              id
              tracked
              inventoryLevels(first: 10) {
                edges {
                  node {
                    available
                    location {
                      id
                    }
                  }
                }
              }
            }
          }
        }
      }
    }`,
    { variables: { first: 250 } },
  );

  const masterJson = (await masterResponse.json()) as {
    data?: {
      productVariants: {
        edges: Array<{
          node: {
            id: string;
            sku?: string;
            inventoryItem?: {
              id: string;
              tracked: boolean;
              inventoryLevels: {
                edges: Array<{
                  node: {
                    available: number;
                    location: { id: string };
                  };
                }>;
              };
            };
          };
        }>;
      };
    };
  };

  let updatedCount = 0;
  const errors: string[] = [];

  for (const { node: variant } of masterJson.data?.productVariants.edges ?? []) {
    if (!variant.sku || !variant.inventoryItem?.tracked) continue;

    const masterLevel = variant.inventoryItem.inventoryLevels.edges[0]?.node;
    if (!masterLevel) continue;

    const mappings = await prisma.productMapping.findMany({
      where: { sku: variant.sku },
      include: { shop: true },
    });

    for (const mapping of mappings) {
      if (mapping.shop.isMasterChannel || !mapping.channelVariantId) continue;

      try {
        const { admin: channelAdmin } = await unauthenticated.admin(
          mapping.shop.myshopifyDomain,
        );
        const channelDetails = await getVariantInventoryDetails(
          channelAdmin,
          mapping.channelVariantId,
        );
        if (!channelDetails?.inventoryItem?.tracked) continue;

        const channelLevel =
          channelDetails.inventoryItem.inventoryLevels.edges[0]?.node;
        if (!channelLevel) continue;

        if (channelLevel.available !== masterLevel.available) {
          await setInventoryOnHand(
            channelAdmin,
            channelDetails.inventoryItem.id,
            channelLevel.location.id,
            masterLevel.available,
          );

          await prisma.inventoryLog.create({
            data: {
              shopId: mapping.shopId,
              sku: variant.sku,
              quantityChange: masterLevel.available - channelLevel.available,
              reason: "periodic_sync",
            },
          });

          updatedCount++;
        }
      } catch (err) {
        errors.push(
          `${mapping.shop.myshopifyDomain}/${variant.sku}: ${(err as Error).message}`,
        );
      }
    }
  }

  return { updated: updatedCount, errors };
}

async function syncChannelOrdersToMaster(
  masterAdmin: AdminApiContext,
): Promise<{ processed: number; errors: string[] }> {
  const masterShop = await getMasterShop();
  if (!masterShop) {
    return { processed: 0, errors: ["Ana mağaza atanmamış."] };
  }

  const channels = await getConnectedChannels();
  if (channels.length === 0) {
    return { processed: 0, errors: [] };
  }

  let processedCount = 0;
  const errors: string[] = [];

  for (const channel of channels) {
    try {
      const { admin: channelAdmin } = await unauthenticated.admin(
        channel.myshopifyDomain,
      );

      const ordersResponse = await channelAdmin.graphql(
        `#graphql
        query GetRecentOrders($first: Int!) {
          orders(first: $first, sortKey: CREATED_AT, reverse: true) {
            edges {
              node {
                id
                name
                createdAt
                lineItems(first: 50) {
                  edges {
                    node {
                      sku
                      quantity
                    }
                  }
                }
              }
            }
          }
        }`,
        { variables: { first: 50 } },
      );

      const ordersJson = (await ordersResponse.json()) as {
        data?: {
          orders: {
            edges: Array<{
              node: {
                id: string;
                name: string;
                createdAt: string;
                lineItems: {
                  edges: Array<{
                    node: {
                      sku?: string;
                      quantity: number;
                    };
                  }>;
                };
              };
            }>;
          };
        };
      };

      for (const { node: order } of ordersJson.data?.orders.edges ?? []) {
        const orderId = order.id;
        const existingOrder = await prisma.channelOrder.findFirst({
          where: { orderId, shopId: channel.id },
        });
        if (existingOrder) continue;

        for (const { node: item } of order.lineItems.edges) {
          if (!item.sku) continue;

          const mappings = await prisma.productMapping.findMany({
            where: { sku: item.sku },
            include: { shop: true },
          });
          const masterMapping = mappings.find((m) => m.shop.isMasterChannel);
          if (!masterMapping?.masterVariantId) continue;

          const details = await getVariantInventoryDetails(
            masterAdmin,
            masterMapping.masterVariantId,
          );
          if (!details?.inventoryItem?.tracked) continue;

          const level = details.inventoryItem.inventoryLevels.edges[0]?.node;
          if (!level) continue;

          await adjustInventory(
            masterAdmin,
            details.inventoryItem.id,
            level.location.id,
            -item.quantity,
            "correction",
            `order:${order.name}`,
          );

          await prisma.inventoryLog.create({
            data: {
              shopId: channel.id,
              sku: item.sku,
              quantityChange: -item.quantity,
              reason: "channel_order",
              orderId: order.name,
            },
          });

          await prisma.channelOrder.create({
            data: {
              shopId: channel.id,
              orderId: order.name,
              sku: item.sku,
              quantity: item.quantity,
              orderedAt: new Date(order.createdAt),
            },
          });

          processedCount++;
        }
      }
    } catch (err) {
      errors.push(
        `${channel.myshopifyDomain}: ${(err as Error).message}`,
      );
    }
  }

  return { processed: processedCount, errors };
}

export async function runFullSync(
  masterAdmin: AdminApiContext,
): Promise<SyncResult> {
  const [stockResult, orderResult] = await Promise.all([
    syncMasterStockToChannels(masterAdmin),
    syncChannelOrdersToMaster(masterAdmin),
  ]);

  await prisma.syncJob.create({
    data: {
      jobType: "full_sync",
      status: "completed",
      payload: {
        stockUpdated: stockResult.updated,
        stockErrors: stockResult.errors,
        ordersProcessed: orderResult.processed,
        orderErrors: orderResult.errors,
      },
    },
  });

  return {
    stockUpdated: stockResult.updated,
    stockErrors: stockResult.errors,
    ordersProcessed: orderResult.processed,
    orderErrors: orderResult.errors,
  };
}

import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { getMasterShop, getConnectedChannels } from "./shop.server";
import {
  getVariantInventoryDetails,
  setInventoryOnHand,
} from "./inventory.server";

export async function runFullSync(admin: AdminApiContext) {
  const masterShop = await getMasterShop();
  if (!masterShop) {
    throw new Error("Ana mağaza atanmamış.");
  }

  const channels = await getConnectedChannels();
  if (channels.length === 0) {
    return { message: "Bağlı kanal yok.", updated: 0 };
  }

  const masterResponse = await admin.graphql(
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
        errors.push(`${mapping.shop.myshopifyDomain}/${variant.sku}: ${(err as Error).message}`);
      }
    }
  }

  await prisma.syncJob.create({
    data: {
      jobType: "full_sync",
      status: errors.length ? "completed" : "completed",
      payload: { updatedCount, errors },
    },
  });

  return { updatedCount, errors };
}

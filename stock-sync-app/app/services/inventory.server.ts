import type { AdminApiContext } from "@shopify/shopify-app-remix/server";
import prisma from "../db.server";
import { getMappingsBySku } from "./mapping.server";

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

export async function getVariantInventoryDetails(
  admin: AdminApiContext,
  variantId: string,
) {
  const response = await admin.graphql(
    `#graphql
    query GetVariantInventory($id: ID!) {
      productVariant(id: $id) {
        id
        sku
        inventoryItem {
          id
          tracked
          inventoryLevels(first: 10) {
            edges {
              node {
                id
                available
                location {
                  id
                  name
                }
              }
            }
          }
        }
      }
    }`,
    { variables: { id: variantId } },
  );

  const json = (await response.json()) as GraphQLResponse<{
    productVariant: {
      id: string;
      sku: string;
      inventoryItem: {
        id: string;
        tracked: boolean;
        inventoryLevels: {
          edges: Array<{
            node: {
              id: string;
              available: number;
              location: { id: string; name: string };
            };
          }>;
        };
      };
    };
  }>;

  return json.data?.productVariant;
}

export async function getInventoryItemById(
  admin: AdminApiContext,
  inventoryItemId: string,
) {
  const response = await admin.graphql(
    `#graphql
    query GetInventoryItem($id: ID!) {
      inventoryItem(id: $id) {
        id
        sku
        tracked
        inventoryLevels(first: 10) {
          edges {
            node {
              id
              available
              location {
                id
                name
              }
            }
          }
        }
      }
    }`,
    { variables: { id: inventoryItemId } },
  );

  const json = (await response.json()) as GraphQLResponse<{
    inventoryItem: {
      id: string;
      sku: string;
      tracked: boolean;
      inventoryLevels: {
        edges: Array<{
          node: {
            id: string;
            available: number;
            location: { id: string; name: string };
          };
        }>;
      };
    };
  }>;

  return json.data?.inventoryItem;
}

export async function adjustInventory(
  admin: AdminApiContext,
  inventoryItemId: string,
  locationId: string,
  delta: number,
  reason = "correction",
  referenceDocumentUri?: string,
) {
  const response = await admin.graphql(
    `#graphql
    mutation InventoryAdjustQuantities($input: InventoryAdjustQuantitiesInput!) {
      inventoryAdjustQuantities(input: $input) {
        inventoryAdjustmentGroup {
          id
          createdAt
          reason
          changes {
            name
            delta
          }
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        input: {
          reason,
          referenceDocumentUri,
          changes: [
            {
              delta,
              inventoryItemId,
              locationId,
            },
          ],
        },
      },
    },
  );

  const json = (await response.json()) as GraphQLResponse<{
    inventoryAdjustQuantities: {
      inventoryAdjustmentGroup?: {
        id: string;
        createdAt: string;
        reason: string;
        changes: Array<{ name: string; delta: number }>;
      };
      userErrors: Array<{ field: string[]; message: string }>;
    };
  }>;

  if (json.data?.inventoryAdjustQuantities.userErrors.length) {
    throw new Error(
      json.data.inventoryAdjustQuantities.userErrors
        .map((e) => e.message)
        .join(", "),
    );
  }

  return json.data?.inventoryAdjustQuantities.inventoryAdjustmentGroup;
}

export async function setInventoryOnHand(
  admin: AdminApiContext,
  inventoryItemId: string,
  locationId: string,
  quantity: number,
) {
  const response = await admin.graphql(
    `#graphql
    mutation InventorySetOnHandQuantities($input: InventorySetOnHandQuantitiesInput!) {
      inventorySetOnHandQuantities(input: $input) {
        inventoryAdjustmentGroup {
          id
          createdAt
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        input: {
          setQuantities: [
            {
              inventoryItemId,
              locationId,
              quantity,
            },
          ],
        },
      },
    },
  );

  const json = (await response.json()) as GraphQLResponse<{
    inventorySetOnHandQuantities: {
      inventoryAdjustmentGroup?: { id: string; createdAt: string };
      userErrors: Array<{ field: string[]; message: string }>;
    };
  }>;

  if (json.data?.inventorySetOnHandQuantities.userErrors.length) {
    throw new Error(
      json.data.inventorySetOnHandQuantities.userErrors
        .map((e) => e.message)
        .join(", "),
    );
  }

  return json.data?.inventorySetOnHandQuantities.inventoryAdjustmentGroup;
}

export async function decreaseMasterStockForChannelOrder(
  admin: AdminApiContext,
  channelShopId: string,
  orderId: string,
  lineItems: Array<{ sku?: string; quantity: number; variantId?: string }>,
) {
  const results = [];

  for (const item of lineItems) {
    const sku = item.sku;
    if (!sku) continue;

    const mappings = await getMappingsBySku(sku);
    const masterMapping = mappings.find((m) => m.shop.isMasterChannel);
    if (!masterMapping?.masterVariantId) continue;

    const details = await getVariantInventoryDetails(
      admin,
      masterMapping.masterVariantId,
    );
    if (!details?.inventoryItem?.tracked) continue;

    const level = details.inventoryItem.inventoryLevels.edges[0]?.node;
    if (!level) continue;

    await adjustInventory(
      admin,
      details.inventoryItem.id,
      level.location.id,
      -item.quantity,
      "correction",
      `order:${orderId}`,
    );

    await prisma.inventoryLog.create({
      data: {
        shopId: channelShopId,
        sku,
        quantityChange: -item.quantity,
        reason: "channel_order",
        orderId,
      },
    });

    await prisma.channelOrder.create({
      data: {
        shopId: channelShopId,
        orderId,
        sku,
        quantity: item.quantity,
        orderedAt: new Date(),
      },
    });

    results.push({ sku, quantity: item.quantity });
  }

  return results;
}

export async function pushStockToChannels(
  admin: AdminApiContext,
  sku: string,
  newAvailable: number,
) {
  const mappings = await prisma.productMapping.findMany({
    where: { sku },
    include: { shop: true },
  });

  const results = [];

  for (const mapping of mappings) {
    if (mapping.shop.isMasterChannel) continue;
    if (!mapping.channelVariantId) continue;

    const details = await getVariantInventoryDetails(
      admin,
      mapping.channelVariantId,
    );
    if (!details?.inventoryItem?.tracked) continue;

    const level = details.inventoryItem.inventoryLevels.edges[0]?.node;
    if (!level) continue;

    await setInventoryOnHand(
      admin,
      details.inventoryItem.id,
      level.location.id,
      newAvailable,
    );

    await prisma.inventoryLog.create({
      data: {
        shopId: mapping.shopId,
        sku,
        quantityChange: newAvailable - level.available,
        reason: "master_stock_sync",
      },
    });

    results.push({
      shopId: mapping.shopId,
      sku,
      newAvailable,
    });
  }

  return results;
}

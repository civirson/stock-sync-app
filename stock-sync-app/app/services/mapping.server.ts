import prisma from "../db.server";

export interface MappingInput {
  shopId: string;
  sku: string;
  barcode?: string;
  masterProductId?: string;
  masterVariantId?: string;
  channelProductId?: string;
  channelVariantId?: string;
}

export async function createOrUpdateMapping(input: MappingInput) {
  return prisma.productMapping.upsert({
    where: {
      shopId_sku: {
        shopId: input.shopId,
        sku: input.sku,
      },
    },
    create: input,
    update: {
      barcode: input.barcode,
      masterProductId: input.masterProductId,
      masterVariantId: input.masterVariantId,
      channelProductId: input.channelProductId,
      channelVariantId: input.channelVariantId,
    },
  });
}

export async function getMappingsByShop(shopId: string) {
  return prisma.productMapping.findMany({
    where: { shopId },
    orderBy: { createdAt: "desc" },
  });
}

export async function getMappingBySku(sku: string) {
  return prisma.productMapping.findFirst({
    where: { sku },
    include: { shop: true },
  });
}

export async function getMappingsBySku(sku: string) {
  return prisma.productMapping.findMany({
    where: { sku },
    include: { shop: true },
  });
}

export async function deleteMapping(id: string) {
  return prisma.productMapping.delete({
    where: { id },
  });
}

export async function getUnmappedChannelVariants(
  shopId: string,
  channelSkus: string[],
) {
  const existing = await prisma.productMapping.findMany({
    where: { shopId },
    select: { sku: true },
  });
  const existingSkus = new Set(existing.map((m) => m.sku));
  return channelSkus.filter((sku) => !existingSkus.has(sku));
}

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../db.server", () => ({
  default: {
    shop: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      upsert: vi.fn(),
    },
    productMapping: {
      findMany: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
    },
    channelOrder: {
      create: vi.fn(),
    },
    inventoryLog: {
      create: vi.fn(),
    },
  },
}));

import prisma from "../../db.server";
import {
  getMasterShop,
  getConnectedChannels,
  upsertShopFromSession,
} from "../shop.server";
import { createOrUpdateMapping, getMappingsByShop } from "../mapping.server";

const mockedPrisma = prisma as unknown as {
  shop: {
    findFirst: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
  };
  productMapping: {
    findMany: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
  };
};

describe("shop.server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getMasterShop returns the first master channel", async () => {
    const expected = {
      id: "shop_1",
      myshopifyDomain: "master.myshopify.com",
      isMasterChannel: true,
    };
    mockedPrisma.shop.findFirst.mockResolvedValue(expected);

    const result = await getMasterShop();

    expect(result).toEqual(expected);
    expect(mockedPrisma.shop.findFirst).toHaveBeenCalledWith({
      where: { isMasterChannel: true },
    });
  });

  it("getConnectedChannels excludes master channel", async () => {
    const expected = [
      { id: "shop_2", myshopifyDomain: "channel1.myshopify.com" },
    ];
    mockedPrisma.shop.findMany.mockResolvedValue(expected);

    const result = await getConnectedChannels();

    expect(result).toEqual(expected);
    expect(mockedPrisma.shop.findMany).toHaveBeenCalledWith({
      where: { isMasterChannel: false },
      orderBy: { createdAt: "desc" },
    });
  });

  it("upsertShopFromSession stores a new shop as master when no master exists", async () => {
    mockedPrisma.shop.count.mockResolvedValue(0);
    mockedPrisma.shop.upsert.mockResolvedValue({
      id: "shop_1",
      myshopifyDomain: "master.myshopify.com",
      isMasterChannel: true,
    });

    await upsertShopFromSession(
      {
        id: "session_1",
        shop: "master.myshopify.com",
        state: "state",
        isOnline: false,
        accessToken: "token",
      } as any,
      true,
    );

    expect(mockedPrisma.shop.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          myshopifyDomain: "master.myshopify.com",
          isMasterChannel: true,
          accessToken: "token",
        }),
      }),
    );
  });
});

describe("mapping.server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("createOrUpdateMapping upserts by shopId and sku", async () => {
    const input = {
      shopId: "shop_2",
      sku: "SKU-001",
      masterVariantId: "gid://shopify/ProductVariant/1",
      channelVariantId: "gid://shopify/ProductVariant/2",
    };
    mockedPrisma.productMapping.upsert.mockResolvedValue({ id: "map_1", ...input });

    await createOrUpdateMapping(input);

    expect(mockedPrisma.productMapping.upsert).toHaveBeenCalledWith({
      where: { shopId_sku: { shopId: input.shopId, sku: input.sku } },
      create: input,
      update: expect.objectContaining({ masterVariantId: input.masterVariantId }),
    });
  });

  it("getMappingsByShop returns mappings ordered by createdAt", async () => {
    const expected = [{ id: "map_1", shopId: "shop_2", sku: "SKU-001" }];
    mockedPrisma.productMapping.findMany.mockResolvedValue(expected);

    const result = await getMappingsByShop("shop_2");

    expect(result).toEqual(expected);
    expect(mockedPrisma.productMapping.findMany).toHaveBeenCalledWith({
      where: { shopId: "shop_2" },
      orderBy: { createdAt: "desc" },
    });
  });
});

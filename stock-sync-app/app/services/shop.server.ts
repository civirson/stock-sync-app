import type { Session } from "@shopify/shopify-api";
import prisma from "../db.server";

export async function getShopByDomain(myshopifyDomain: string) {
  return prisma.shop.findUnique({
    where: { myshopifyDomain },
  });
}

export async function getMasterShop() {
  return prisma.shop.findFirst({
    where: { isMasterChannel: true },
  });
}

export async function getConnectedChannels() {
  return prisma.shop.findMany({
    where: { isMasterChannel: false },
    orderBy: { createdAt: "desc" },
  });
}

export async function upsertShopFromSession(session: Session, isMaster = false) {
  const domain = session.shop;
  const accessToken = session.accessToken;
  if (!accessToken) {
    throw new Error("Session access token is missing");
  }
  return prisma.shop.upsert({
    where: { myshopifyDomain: domain },
    create: {
      myshopifyDomain: domain,
      accessToken,
      isMasterChannel: isMaster,
      channelName: isMaster ? "Ana Mağaza" : domain,
    },
    update: {
      accessToken,
      isMasterChannel: isMaster,
    },
  });
}

export async function setMasterChannel(id: string) {
  await prisma.shop.updateMany({
    where: { isMasterChannel: true },
    data: { isMasterChannel: false },
  });
  return prisma.shop.update({
    where: { id },
    data: { isMasterChannel: true },
  });
}

export async function removeChannel(id: string) {
  return prisma.shop.delete({
    where: { id },
  });
}

export async function addChannelShop(
  myshopifyDomain: string,
  accessToken: string,
  channelName?: string,
) {
  return prisma.shop.upsert({
    where: { myshopifyDomain },
    create: {
      myshopifyDomain,
      accessToken,
      isMasterChannel: false,
      channelName: channelName ?? myshopifyDomain,
    },
    update: {
      accessToken,
      channelName: channelName ?? myshopifyDomain,
    },
  });
}

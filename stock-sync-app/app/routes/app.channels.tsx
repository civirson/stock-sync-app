import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigate } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  TextField,
  Button,
  DataTable,
  InlineStack,
  BlockStack,
  Banner,
  FormLayout,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import {
  addChannelShop,
  getConnectedChannels,
  getMasterShop,
  removeChannel,
  setMasterChannel,
} from "../services/shop.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  let masterShop = await getMasterShop();
  const channels = await getConnectedChannels();

  // Auto-assign the oldest connected channel as master if none exists
  if (!masterShop && channels.length > 0) {
    const oldestChannel = channels.reduce((oldest, current) =>
      new Date(current.createdAt) < new Date(oldest.createdAt)
        ? current
        : oldest,
    );
    await setMasterChannel(oldestChannel.id);
    masterShop = await getMasterShop();
  }

  return { masterShop, channels };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "add") {
    const domain = formData.get("domain") as string;
    const accessToken = formData.get("accessToken") as string;
    const channelName = formData.get("channelName") as string;

    if (!domain || !accessToken) {
      return { error: "Domain ve access token zorunludur." };
    }

    const normalizedDomain = domain.trim().toLowerCase();
    await addChannelShop(normalizedDomain, accessToken, channelName || undefined);
    return { success: true };
  }

  if (intent === "delete") {
    const id = formData.get("id") as string;
    await removeChannel(id);
    return { success: true };
  }

  if (intent === "setMaster") {
    const id = formData.get("id") as string;
    await setMasterChannel(id);
    return { success: true };
  }

  return null;
};

export default function ChannelsPage() {
  const { masterShop, channels } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const navigate = useNavigate();
  const [domain, setDomain] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [channelName, setChannelName] = useState("");
  const [oauthDomain, setOauthDomain] = useState("");

  const rows = channels.map((channel) => [
    channel.channelName ?? channel.myshopifyDomain,
    channel.myshopifyDomain,
    channel.id === masterShop?.id ? "Ana Mağaza" : "Satış Kanalı",
    <InlineStack gap="200" key={channel.id}>
      {channel.id !== masterShop?.id && (
        <Button
          size="micro"
          onClick={() =>
            submit(
              { intent: "setMaster", id: channel.id },
              { method: "post", replace: true },
            )
          }
        >
          Ana Mağaza Yap
        </Button>
      )}
      <Button
        tone="critical"
        size="micro"
        onClick={() =>
          submit(
            { intent: "delete", id: channel.id },
            { method: "post", replace: true },
          )
        }
      >
        Sil
      </Button>
    </InlineStack>,
  ]);

  return (
    <Page>
      <TitleBar title="Satış Kanalları" />
      <BlockStack gap="500">
        <Banner tone="info">
          Buraya bağlamak istediğiniz Shopify mağazasının myshopify.com domainini
          ve custom app access token’ını girin. Bu bilgiler sadece stok
          senkronizasyonu için kullanılır.
        </Banner>

        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Yeni Kanal Ekle
                </Text>
                <FormLayout>
                  <TextField
                    label="Kanal Adı"
                    value={channelName}
                    onChange={setChannelName}
                    autoComplete="off"
                    helpText="Opsiyonel"
                  />
                  <TextField
                    label="MyShopify Domain"
                    value={domain}
                    onChange={setDomain}
                    autoComplete="off"
                    placeholder="ornek.myshopify.com"
                    helpText="Bağlanacak mağazanın myshopify.com adresi"
                  />
                  <TextField
                    label="Admin API Access Token"
                    value={accessToken}
                    onChange={setAccessToken}
                    autoComplete="off"
                    type="password"
                    helpText="Hedef mağazada oluşturulan custom app’in access token’ı"
                  />
                  <Button
                    variant="primary"
                    onClick={() => {
                      submit(
                        {
                          intent: "add",
                          domain,
                          accessToken,
                          channelName,
                        },
                        { method: "post", replace: true },
                      );
                      setDomain("");
                      setAccessToken("");
                      setChannelName("");
                    }}
                  >
                    Kanal Ekle
                  </Button>
                </FormLayout>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Shopify Mağazası Bağla (Önerilen)
                </Text>
                <Banner tone="info">
                  Hedef mağazanın yöneticisi olarak giriş yaptığınız bir
                  tarayıcı sekmesinde bu bağlantıyı kullanın. Shopify güvenli
                  OAuth akışıyla token otomatik kaydedilir.
                </Banner>
                <FormLayout>
                  <TextField
                    label="MyShopify Domain"
                    value={oauthDomain}
                    onChange={setOauthDomain}
                    autoComplete="off"
                    placeholder="ornek.myshopify.com"
                    helpText="Bağlanacak mağazanın myshopify.com adresi"
                  />
                  <Button
                    variant="primary"
                    onClick={() => {
                      const normalized = oauthDomain
                        .trim()
                        .toLowerCase()
                        .replace(/^https?:\/\//, "");
                      if (!normalized) return;
                      window.open(
                        `/auth/login?shop=${encodeURIComponent(normalized)}`,
                        "_blank",
                      );
                    }}
                  >
                    Shopify ile Bağlan
                  </Button>
                </FormLayout>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">
                  Bağlı Kanallar
                </Text>
                <DataTable
                  columnContentTypes={["text", "text", "text", "text"]}
                  headings={["Ad", "Domain", "Rol", "İşlemler"]}
                  rows={rows.length ? rows : [["—", "—", "—", "—"]]}
                />
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}

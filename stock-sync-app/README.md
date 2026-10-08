# Çok Kanallı Shopify Stok Senkronizasyon Uygulaması

Bu proje, kendi ana Shopify mağazanızı merkez alarak diğer Shopify mağazalarıyla SKU/barkod eşleştirmesi üzerinden stok senkronizasyonu yapan bir Shopify uygulamasıdır.

## Özellikler

- **Merkezi stok yönetimi:** Ana mağaza tek doğru kaynak (source of truth) olarak çalışır.
- **Çift yönlü senkronizasyon:**
  - Satış kanalından sipariş geldiğinde ana mağaza stoğu otomatik düşer.
  - Ana mağazadaki stok değiştiğinde bağlı kanallara anlık güncelleme gider.
- **Veri izolasyonu:** Kanallar birbirinin fiyat, müşteri ve sipariş detaylarını görmez; yalnızca kendi stok verileri güncellenir.
- **Kanal bazlı raporlama:** Hangi kanaldan kaç adet hangi SKU satıldığı görülebilir.
- **Periyodik senkronizasyon:** 15 dakikada bir tüm kanallardaki stoklar ana mağaza ile eşitlenir.
- **Webhook + periyodik senkronizasyon:** Hem anlık webhook hem de arka plan senkronizasyonu desteklenir.

## Teknolojiler

- [Shopify App Template — Remix](https://github.com/Shopify/shopify-app-template-remix)
- [Remix](https://remix.run)
- [Prisma ORM](https://www.prisma.io/)
- [PostgreSQL](https://www.postgresql.org/)
- [Shopify Admin GraphQL API](https://shopify.dev/docs/api/admin-graphql)
- [Vitest](https://vitest.dev/)

## Başlangıç

### 1. Gereksinimler

- Node.js 20+
- PostgreSQL veritabanı
- Shopify Partners hesabı ve bir app tanımı

### 2. Ortam Değişkenleri

`.env.example` dosyasını `.env` olarak kopyalayın ve kendi değerlerinizi girin:

```bash
cp .env.example .env
```

```env
SHOPIFY_API_KEY=your_app_api_key
SHOPIFY_API_SECRET=your_app_api_secret
SCOPES=read_products,write_products,read_inventory,write_inventory,read_orders,read_all_orders
SHOPIFY_APP_URL=https://your-app-url.com
DATABASE_URL=postgresql://user:password@localhost:5432/stock_sync
REDIS_URL=redis://localhost:6379
CRON_SECRET=your_random_cron_secret
```

### 3. Veritabanı Kurulumu

```bash
npx prisma generate
npx prisma migrate dev --name init
```

### 4. Geliştirme Sunucusu

```bash
npm run dev
```

### 5. Build

```bash
npm run build
```

### 6. Testler

```bash
npm test
```

## Shopify App Yapılandırması

1. [Shopify Partners](https://partners.shopify.com/) üzerinden bir app oluşturun.
2. `shopify.app.toml` dosyasındaki `client_id` alanını doldurun.
3. App URL ve redirect URL'leri Shopify dashboard'dan ayarlayın.
4. Webhook URL'lerinin doğru çalıştığından emin olun:
   - `/webhooks/orders/create`
   - `/webhooks/orders/updated`
   - `/webhooks/inventory_levels/update`

## Kullanım

1. Uygulamayı ana mağazanıza kurun. İlk kurulan mağaza otomatik olarak ana mağaza atanır.
2. **Kanallar** sayfasından satış kanalı olarak kullanmak istediğiniz diğer Shopify mağazalarını ekleyin.
   - Hedef mağazada bir **custom app** oluşturun.
   - Admin API access token'ı kopyalayın.
   - Uygulamaya domain ve token bilgilerini girin.
3. **Eşleştirme** sayfasında ana mağaza ile kanal mağazası arasındaki ürünleri SKU/barkod ile eşleştirin.
4. **Raporlar** sayfasından kanal bazlı satışları takip edin.

## Periyodik Senkronizasyon

`/api/sync` endpoint'ine `x-cron-secret` header'ı ile POST isteği gönderildiğinde periyodik senkronizasyon çalışır. Örnek cron ayarı:

```bash
curl -X POST https://your-app-url.com/api/sync \
  -H "x-cron-secret: your_random_cron_secret"
```

Vercel, AWS EventBridge, GitHub Actions veya benzeri bir scheduler ile 15 dakikada bir çalıştırabilirsiniz.

## Güvenlik

- Tüm webhook istekleri Shopify HMAC doğrulamasından geçer.
- Her kanalın access token'ı yalnızca kendi kayıtları için kullanılır.
- Loglarda sadece SKU, adet, sipariş ID ve kanal bilgisi tutulur; müşteri/fiyat verisi kaydedilmez.
- Periyodik senkronizasyon endpoint'i `CRON_SECRET` ile korunur.

## Deployment

### Vercel

1. Proje dizinine gidin: `cd stock-sync-app`
2. Vercel CLI ile deploy edin: `vercel`
3. Ortam değişkenlerini Vercel dashboard'dan tanımlayın.
4. `SHOPIFY_APP_URL` değerini Vercel production URL'si olarak güncelleyin.

### Kendi Sunucunuz

```bash
npm ci
npm run setup
npm run build
npm start
```

HTTPS ve canlı bir domain gereklidir (Shopify webhook'ları HTTPS zorunlu).

## Gelecek Geliştirmeler

- Shopify dışı platformlar (Amazon SP-API, Trendyol, Hepsiburada vb.) için connector modülleri
- Çoklu location/depo desteği
- Güvenlik stoku (buffer stock) ayarı
- Otomatik fiyat senkronizasyonu (opsiyonel)

## Lisans

MIT

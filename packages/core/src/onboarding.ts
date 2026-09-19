export type TemplateItemDef = {
  code: string;
  name: string;
  uom: string;
  cost: number;
  price: number;
  kind: "goods" | "service" | "material" | "finished";
  bom?: [string, number][] | null;
};

export type TemplatePayload = {
  extKey: string | null;
  extSamples: string[];
  items: TemplateItemDef[];
  accounts: { code: string; name: string }[];
};

export type IndustryTemplate = {
  code: string;
  name: string;
  extLabel: string | null;
  payload: TemplatePayload;
};

export type SeedItem = {
  code: string;
  name: string;
  uom: string;
  price: number;
  cost: number;
  kind: TemplateItemDef["kind"];
  bom: [string, number][] | null;
  isSample: boolean;
};
export type SeedPartner = {
  code: string;
  name: string;
  kind: "customer" | "supplier" | "both";
  creditLimit: number;
  isSample: boolean;
};
export type SeedWarehouse = { code: string; name: string };
export type SeedAccount = { code: string; name: string };
/** GĐ6 mới có bảng lưu — lô 1.1 chỉ tính toán, chưa ghi DB. */
export type SeedExtObject = { code: string; name: string; isSample: boolean };
/** GĐ2 mới có bảng tồn kho — lô 1.1 chỉ tính toán, chưa ghi DB. */
export type SeedOpeningMove = { itemCode: string; warehouseCode: string; qty: number; cost: number };

export type TenantSeed = {
  items: SeedItem[];
  partners: SeedPartner[];
  warehouses: SeedWarehouse[];
  accounts: SeedAccount[];
  extObjects: SeedExtObject[];
  openingMoves: SeedOpeningMove[];
};

/**
 * Port từ demo/core.js `createTenant` — chỉ TÍNH TOÁN dữ liệu mẫu, không ghi DB (server ghi trong
 * transaction ở apps/web/src/server/onboarding.ts). Kho + đối tượng mở rộng + tồn đầu chỉ tính sẵn
 * hình dạng cho GĐ2/GĐ6 dùng lại; lô 1.1 chỉ ghi items/partners/warehouses/accounts (bảng đã có).
 */
export function buildTenantSeed(template: IndustryTemplate, withSample: boolean): TenantSeed {
  const items: SeedItem[] = template.payload.items.map((i) => ({
    code: i.code,
    name: i.name,
    uom: i.uom,
    price: i.price,
    cost: i.cost,
    kind: i.kind,
    bom: i.bom ?? null,
    isSample: true,
  }));

  const warehouses: SeedWarehouse[] = [
    { code: "K1", name: "Kho chính" },
    { code: "QC", name: "Kho chờ kiểm" },
  ];
  const accounts: SeedAccount[] = template.payload.accounts.map((a) => ({ code: a.code, name: a.name }));

  const extObjects: SeedExtObject[] = template.payload.extKey
    ? template.payload.extSamples.map((name, i) => ({
        code: `${template.payload.extKey}${i + 1}`,
        name,
        isSample: true,
      }))
    : [];

  const partners: SeedPartner[] = [];
  const openingMoves: SeedOpeningMove[] = [];

  if (withSample) {
    partners.push(
      { code: "KH1", name: "Công ty Khách A", kind: "customer", creditLimit: 50000000, isSample: true },
      { code: "KH2", name: "Anh Bình (khách lẻ)", kind: "customer", creditLimit: 0, isSample: true },
      { code: "NCC1", name: "Nhà cung cấp B", kind: "supplier", creditLimit: 0, isSample: true },
    );
    for (const it of items) {
      if (it.kind === "service") continue;
      const qty = it.kind === "finished" ? 0 : 6;
      if (qty > 0) openingMoves.push({ itemCode: it.code, warehouseCode: "K1", qty, cost: it.cost });
    }
  }

  return { items, partners, warehouses, accounts, extObjects, openingMoves };
}

// P2-PROC: связь закупок и заявок на обеспечение с модулем «Склад» — только через публичный warehouseApi.
// Модуль склада загружается лениво (он сам импортирует api ядра — статический импорт дал бы цикл загрузки).
import { can } from '../security';
import type { ID, User } from '../types';
import { coreTables, procTables } from './procStore';

const wh = () => import('../modules/warehouse');

/** Автоматические складские операции выполняются от имени заведующего складом, если у инициатора нет прав склада. */
async function actorFor(warehouseId: string, user: User): Promise<User> {
  if (can(user, 'warehouse', 'edit')) return user;
  const { warehouseApi } = await wh();
  const loc = (await warehouseApi.listLocations()).find((l) => l.id === warehouseId);
  const manager = coreTables().users.find((u) => u.id === loc?.managerId) ?? coreTables().users.find((u) => u.role === 'storekeeper');
  return manager ?? user;
}

/** Группа складской карточки по категории номенклатуры закупок. */
function groupFor(category: string, fixedAsset: boolean): string | undefined {
  if (fixedAsset) return 'g-os';
  return ({ office: 'g-of', household: 'g-hh', security: 'g-sc', it_hw: 'g-it', furniture: 'g-mb' } as Record<string, string>)[category];
}

export interface WhReceiveInput {
  warehouseId: string;
  contractId: ID;
  contractNumber: string;
  procurementId?: ID;
  supplierId: ID;
  einvoiceId?: ID;
  costCenterKey: string;
  acceptanceNumber: string;
  lines: { name: string; sku?: string; unit: string; qty: number; unitPrice: number }[];
}

export const whBridge = {
  /** Оприходование принятых товаров приходным ордером склада (М-4) с привязкой к договору и заявке. */
  async receive(input: WhReceiveInput, user: User): Promise<{ movementIds: ID[]; posted: boolean; receiptId?: ID }> {
    const { warehouseApi } = await wh();
    const actor = await actorFor(input.warehouseId, user);
    const cards = await warehouseApi.listCards({ includeArchived: false });
    const cat = procTables().catalog;
    const lines: { cardId: ID; qty: number; price: number; expiryDate?: string }[] = [];
    for (const l of input.lines) {
      let card: { id: string; trackExpiry: boolean; shelfLifeDays?: number } | undefined = cards.find((c) => (l.sku && c.cardNo === l.sku) || c.name === l.name);
      const ci = cat.find((c) => c.name.ru === l.name || (l.sku && c.warehouseSku === l.sku));
      if (!card) {
        const groupId = groupFor(ci?.category ?? '', !!ci?.fixedAsset);
        if (!groupId) continue; // услуги, лицензии — на склад не приходуются
        card = await warehouseApi.saveCard({ name: l.name, groupId, unit: l.unit, offBalance: false, trackExpiry: false, defaultPrice: l.unitPrice, note: `Создано при приёмке ${input.acceptanceNumber}` }, actor, `Приёмка ${input.acceptanceNumber}`);
      }
      const expiry = card.trackExpiry ? new Date(Date.now() + (card.shelfLifeDays ?? 365) * 86_400_000).toISOString().slice(0, 10) : undefined;
      lines.push({ cardId: card.id, qty: l.qty, price: l.unitPrice, ...(expiry ? { expiryDate: expiry } : {}) });
    }
    if (!lines.length) return { movementIds: [], posted: false };
    const r = await warehouseApi.saveReceipt(
      {
        warehouseId: input.warehouseId,
        supplierId: input.supplierId,
        contractId: input.contractId,
        ...(input.procurementId ? { procurementId: input.procurementId } : {}),
        waybillNo: input.acceptanceNumber,
        waybillDate: new Date().toISOString().slice(0, 10),
        lines,
        costCenterId: input.costCenterKey,
      },
      actor,
      true,
      `Акт приёмки ${input.acceptanceNumber} по договору ${input.contractNumber}`,
    );
    const movements = await warehouseApi.listMovements({ search: r.number });
    return { movementIds: movements.map((m) => m.id), posted: true, receiptId: r.id };
  },

  /** Перемещение со склада на склад филиала (распределение сводной закупки). */
  async transfer(input: { fromWarehouseId: string; toWarehouseId: string; sku?: string; name: string; qty: number; comment: string }, user: User): Promise<ID | undefined> {
    const { warehouseApi } = await wh();
    const actor = await actorFor(input.fromWarehouseId, user);
    const items = await warehouseApi.listItems({ warehouseId: input.fromWarehouseId });
    const it = items.find((i) => (input.sku && i.sku === input.sku) || i.name === input.name);
    if (!it) return undefined;
    const mv = await warehouseApi.createMovement({ type: 'transfer', itemId: it.id, qty: Math.min(input.qty, it.qty - it.reserved), toWarehouseId: input.toWarehouseId, comment: input.comment }, actor);
    return mv.id;
  },

  /** Остатки склада для формы заявки на обеспечение (доступно = остаток − резерв). */
  async stock(warehouseId?: string) {
    const { warehouseApi } = await wh();
    const items = await warehouseApi.listItems(warehouseId ? { warehouseId } : {});
    return items.map((i) => ({ id: i.id, sku: i.sku, name: i.name, unit: i.unit, warehouseId: i.warehouseId, qty: i.qty, reserved: i.reserved, available: Math.max(0, i.qty - i.reserved), unitCost: i.unitCost, category: i.category }));
  },

  async locations() {
    const { warehouseApi } = await wh();
    return warehouseApi.listLocations();
  },
};

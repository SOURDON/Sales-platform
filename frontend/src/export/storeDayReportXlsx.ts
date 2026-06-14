import ExcelJS from 'exceljs';
import { percentForStore, type AcquiringProfile } from '../acquiring/acquiringConfig';
import { DEFAULT_MANAGER_STORE_COMMISSIONS } from '../inventory/normalizeInventoryOverview';
import { saveXlsxFile, type SaveXlsxResult } from './saveXlsxFile';

export type StoreDayReportSellerRow = {
  name: string;
  salesRub: number;
  salaryRub: number;
  tier: 'best' | 'top3' | 'zero' | 'normal';
};

export type StoreDayReportProductRow = {
  name: string;
  qty: number;
};

export type StoreDayReportDeletedSaleRow = {
  sellerName: string;
  amount: number;
  reason: string;
  statusLabel: string;
  deletedAt: string;
};

export type StoreDayReportStaffBlock = {
  name: string;
  salaryRub: number;
  hint?: string;
};

export type StoreDayReportData = {
  storeName: string;
  dayKey: string;
  dayLabel: string;
  revenue: number;
  cash: number;
  acquiringGross: number;
  acquiringRatePercent: number;
  acquiringFee: number;
  acquiringNet: number;
  transfer: number;
  salariesTotal: number;
  salesSalariesTotal: number;
  checksCount: number;
  unitsSold: number;
  sellers: StoreDayReportSellerRow[];
  products: StoreDayReportProductRow[];
  manager?: StoreDayReportStaffBlock;
  retoucher?: StoreDayReportStaffBlock;
  shiftLabel?: string;
  deletedSales?: StoreDayReportDeletedSaleRow[];
  generatedAt: string;
};

type SaleLine = {
  sellerId: number;
  totalAmount: number;
  units?: number;
  paymentType?: 'CASH' | 'NON_CASH' | 'TRANSFER';
  items: Array<{ name: string; qty: number }>;
  createdAt: string;
};

type SellerLike = {
  id: number;
  fullName: string;
  nickname: string;
  storeName: string;
  ratePercent: number;
};

type StaffLike = {
  id: number;
  fullName: string;
  nickname: string;
  isActive: boolean;
  assignedShiftId?: string;
  staffPosition: string;
  retoucherRatePercent?: number;
  assignedStores?: string[];
};

type ShiftLike = {
  id: string;
  status: 'OPEN' | 'CLOSED';
  openedAt: string;
  assignedSellerIds: number[];
};

type ManagerCommissionRow = { storeName: string; percent: number };

/** Спокойная палитра (беж · тёмный бирюз · бирюза · бордо · светло-серый). */
const C = {
  pageBg: 'FFF8F5F0',
  heroDark: 'FF1E4A56',
  heroMid: 'FF2A5C6A',
  heroText: 'FFF8F5F0',
  heroMuted: 'FFB8CDD6',
  blockRevenue: 'FF5FA8B8',
  blockSalary: 'FF7A4848',
  blockManager: 'FF6B5550',
  blockRetoucher: 'FF4A8A96',
  blockCash: 'FF6DB5C5',
  blockAcq: 'FF5A9AAA',
  blockAcqNet: 'FF4E8E88',
  blockTransfer: 'FF9A8578',
  blockSalesPay: 'FF8B6B5E',
  blockCashSoft: 'FFE8F4F7',
  blockAcqSoft: 'FFE5F0F3',
  blockTransferSoft: 'FFF5EDE8',
  sectionBg: 'FFDCE8EC',
  sectionText: 'FF1E4A56',
  headerBg: 'FFE8EFF2',
  headerText: 'FF1E4A56',
  rowNormalA: 'FFFFFFFF',
  rowNormalB: 'FFF5F0E8',
  rowText: 'FF2C4550',
  rowBest: 'FF7A4848',
  rowBestAccent: 'FF5A3030',
  rowBestText: 'FFFFFFFF',
  rowTop3: 'FFE8F2F5',
  rowTop3Accent: 'FF5FA8B8',
  rowTop3Text: 'FF1E4A56',
  rowZero: 'FFF2EFEA',
  rowZeroText: 'FF8A9599',
  totalBg: 'FF1E4A56',
  totalText: 'FFF8F5F0',
  border: 'FFB8CDD6',
  borderDark: 'FF2A5C6A',
  muted: 'FF6B848D',
  onColorLabel: 'FFE8F4F6',
  onColorValue: 'FFFFFFFF',
};

/** A4 альбомная: 1 лист по ширине и высоте (компактный макет ≈ 90–100% без узкой полоски). */
function applyDayReportPrintSetup(sheet: ExcelJS.Worksheet, lastRow: number) {
  sheet.pageSetup.printArea = `A1:L${lastRow}`;
  sheet.pageSetup.paperSize = 9;
  sheet.pageSetup.orientation = 'landscape';
  sheet.pageSetup.fitToPage = true;
  sheet.pageSetup.fitToWidth = 1;
  sheet.pageSetup.fitToHeight = 1;
  sheet.pageSetup.horizontalCentered = true;
  sheet.pageSetup.showGridLines = false;
  sheet.pageSetup.showRowColHeaders = false;
  sheet.pageSetup.margins = {
    left: 0.2,
    right: 0.2,
    top: 0.2,
    bottom: 0.2,
    header: 0.08,
    footer: 0.08,
  };
}

function formatDayLabel(dayKey: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (match) {
    return `${match[3]}.${match[2]}.${match[1]}`;
  }
  return dayKey;
}

function formatPerson(fullName: string, nickname?: string): string {
  const nick = nickname?.trim();
  return nick ? `${fullName.trim()} — ${nick}` : fullName.trim();
}

function calendarDayKeyMoscow(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

function staffAssignedStores(member: StaffLike): string[] {
  const fromApi = Array.isArray(member.assignedStores) ? member.assignedStores : [];
  return fromApi.filter((name) => typeof name === 'string' && name.trim().length > 0);
}

function roundRub(n: number): number {
  return Math.round(n);
}

function pct(part: number, whole: number): number {
  if (whole <= 0) {
    return 0;
  }
  return Math.round((part / whole) * 1000) / 10;
}

function managerPercentForStore(storeName: string, rows: ManagerCommissionRow[]): number {
  const list = rows.length > 0 ? rows : [...DEFAULT_MANAGER_STORE_COMMISSIONS];
  const row = list.find((item) => item.storeName === storeName);
  const value = row?.percent ?? 5;
  return Math.max(0, Math.min(100, value));
}

function storeRevenueForDay(
  storeName: string,
  sales: SaleLine[],
  sellers: SellerLike[],
  dayKey: string,
): number {
  const sellerIds = new Set(sellers.filter((s) => s.storeName === storeName).map((s) => s.id));
  let total = 0;
  for (const sale of sales) {
    if (calendarDayKeyMoscow(sale.createdAt) !== dayKey) {
      continue;
    }
    if (sellerIds.has(sale.sellerId)) {
      total += sale.totalAmount;
    }
  }
  return total;
}

function managerEarnForDay(
  storeName: string,
  sales: SaleLine[],
  sellers: SellerLike[],
  dayKey: string,
  commissionRows: ManagerCommissionRow[],
): number {
  const rate = managerPercentForStore(storeName, commissionRows);
  if (rate <= 0) {
    return 0;
  }
  const revenue = storeRevenueForDay(storeName, sales, sellers, dayKey);
  return Math.round((revenue * rate) / 100);
}

function retoucherEarnForDay(
  storeName: string,
  sales: SaleLine[],
  sellers: SellerLike[],
  ratePercent: number,
  dayKey: string,
): number {
  const sellerIds = new Set(sellers.filter((s) => s.storeName === storeName).map((s) => s.id));
  let dayRevenue = 0;
  for (const sale of sales) {
    if (!sellerIds.has(sale.sellerId)) {
      continue;
    }
    if (calendarDayKeyMoscow(sale.createdAt) === dayKey) {
      dayRevenue += sale.totalAmount;
    }
  }
  return Math.round((dayRevenue * ratePercent) / 100);
}

function sellerTier(salesRub: number, rank: number): StoreDayReportSellerRow['tier'] {
  if (salesRub <= 0) {
    return 'zero';
  }
  if (rank === 0) {
    return 'best';
  }
  if (rank <= 2) {
    return 'top3';
  }
  return 'normal';
}

export function buildStoreDayReportData(options: {
  storeName: string;
  dayKey: string;
  sales: SaleLine[];
  sellers: SellerLike[];
  staff: StaffLike[];
  shifts: ShiftLike[];
  acquiringProfiles: AcquiringProfile[];
  managerStoreCommissions?: ManagerCommissionRow[];
  deletedSales?: StoreDayReportDeletedSaleRow[];
}): StoreDayReportData {
  const {
    storeName,
    dayKey,
    sales,
    sellers,
    staff,
    shifts,
    acquiringProfiles,
    managerStoreCommissions = [],
    deletedSales = [],
  } = options;

  const sellerIds = new Set(
    sellers.filter((seller) => seller.storeName === storeName).map((seller) => seller.id),
  );
  const storeSales = sales.filter(
    (sale) => sellerIds.has(sale.sellerId) && calendarDayKeyMoscow(sale.createdAt) === dayKey,
  );

  let revenue = 0;
  let cash = 0;
  let acquiringGross = 0;
  let transfer = 0;
  let unitsSold = 0;

  for (const sale of storeSales) {
    revenue += sale.totalAmount;
    unitsSold += sale.units ?? sale.items.reduce((sum, line) => sum + line.qty, 0);
    if (sale.paymentType === 'TRANSFER') {
      transfer += sale.totalAmount;
    } else if (sale.paymentType === 'NON_CASH') {
      acquiringGross += sale.totalAmount;
    } else {
      cash += sale.totalAmount;
    }
  }

  const acquiringRatePercent = percentForStore(storeName, acquiringProfiles);
  const acquiringFee = Math.round((acquiringGross * acquiringRatePercent) / 100);
  const acquiringNet = acquiringGross - acquiringFee;

  const salesBySeller = new Map<number, number>();
  for (const sale of storeSales) {
    salesBySeller.set(sale.sellerId, (salesBySeller.get(sale.sellerId) ?? 0) + sale.totalAmount);
  }

  const staffAtStore = staff.filter(
    (member) => member.isActive && staffAssignedStores(member).includes(storeName),
  );
  const openShift = shifts.find((shift) => shift.status === 'OPEN');
  const inShiftIds = openShift
    ? staffAtStore
        .filter((member) => member.assignedShiftId === openShift.id)
        .map((member) => member.id)
    : [];

  const sellerRows: Array<Omit<StoreDayReportSellerRow, 'tier'>> = [];
  const seenIds = new Set<number>();
  let managerBlock: StoreDayReportStaffBlock | undefined;
  let retoucherBlock: StoreDayReportStaffBlock | undefined;

  for (const staffId of inShiftIds) {
    const member = staffAtStore.find((item) => item.id === staffId);
    const seller = sellers.find((item) => item.id === staffId);
    if (!member) {
      continue;
    }
    seenIds.add(staffId);

    if (member.staffPosition === 'MANAGER') {
      const managerPct = managerPercentForStore(storeName, managerStoreCommissions);
      const managerSalary = managerEarnForDay(
        storeName,
        sales,
        sellers,
        dayKey,
        managerStoreCommissions,
      );
      managerBlock = {
        name: formatPerson(member.fullName, member.nickname),
        salaryRub: managerSalary,
        hint: `${managerPct}% от выручки точки`,
      };
      continue;
    }

    if (member.staffPosition === 'RETOUCHER') {
      const ratePct = member.retoucherRatePercent ?? 5;
      retoucherBlock = {
        name: formatPerson(member.fullName, member.nickname),
        salaryRub: retoucherEarnForDay(storeName, sales, sellers, ratePct, dayKey),
        hint: `${ratePct}% от выручки точки`,
      };
      continue;
    }

    const salesRub = Math.round(salesBySeller.get(staffId) ?? 0);
    const ratePercent = seller?.ratePercent ?? 0;
    sellerRows.push({
      name: formatPerson(
        member.fullName ?? seller?.fullName ?? `Сотрудник #${staffId}`,
        member.nickname ?? seller?.nickname,
      ),
      salesRub,
      salaryRub: Math.round((salesRub * ratePercent) / 100),
    });
  }

  for (const [sellerId, salesRubRaw] of salesBySeller) {
    if (seenIds.has(sellerId)) {
      continue;
    }
    const seller = sellers.find((item) => item.id === sellerId);
    const member = staffAtStore.find((item) => item.id === sellerId);
    if (member?.staffPosition === 'MANAGER' || member?.staffPosition === 'RETOUCHER') {
      continue;
    }
    const salesRub = Math.round(salesRubRaw);
    sellerRows.push({
      name: formatPerson(seller?.fullName ?? `Продавец #${sellerId}`, seller?.nickname),
      salesRub,
      salaryRub: Math.round((salesRub * (seller?.ratePercent ?? 0)) / 100),
    });
  }

  sellerRows.sort((a, b) => b.salesRub - a.salesRub || a.name.localeCompare(b.name, 'ru-RU'));
  const sellersWithTier: StoreDayReportSellerRow[] = sellerRows.map((row, index) => ({
    ...row,
    tier: sellerTier(row.salesRub, index),
  }));

  if (!managerBlock) {
    const managerMember = staffAtStore.find((member) => member.staffPosition === 'MANAGER');
    if (managerMember) {
      const managerPct = managerPercentForStore(storeName, managerStoreCommissions);
      managerBlock = {
        name: formatPerson(managerMember.fullName, managerMember.nickname),
        salaryRub: managerEarnForDay(storeName, sales, sellers, dayKey, managerStoreCommissions),
        hint: `${managerPct}% от выручки точки`,
      };
    }
  }

  if (!retoucherBlock) {
    const retoucherMember = staffAtStore.find((member) => member.staffPosition === 'RETOUCHER');
    if (retoucherMember) {
      const ratePct = retoucherMember.retoucherRatePercent ?? 5;
      retoucherBlock = {
        name: formatPerson(retoucherMember.fullName, retoucherMember.nickname),
        salaryRub: retoucherEarnForDay(storeName, sales, sellers, ratePct, dayKey),
        hint: `${ratePct}% от выручки точки`,
      };
    }
  }

  const salesSalariesTotal = sellersWithTier.reduce((sum, row) => sum + row.salaryRub, 0);
  const salariesTotal =
    salesSalariesTotal +
    (managerBlock?.salaryRub ?? 0) +
    (retoucherBlock?.salaryRub ?? 0);

  const qtyByProduct = new Map<string, number>();
  for (const sale of storeSales) {
    for (const line of sale.items ?? []) {
      qtyByProduct.set(line.name, (qtyByProduct.get(line.name) ?? 0) + line.qty);
    }
  }
  const products: StoreDayReportProductRow[] = Array.from(qtyByProduct.entries())
    .map(([name, qty]) => ({ name, qty }))
    .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name, 'ru-RU'));

  const shiftLabel = openShift
    ? `Смена открыта ${new Date(openShift.openedAt).toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })}`
    : 'Смена закрыта';

  return {
    storeName,
    dayKey,
    dayLabel: formatDayLabel(dayKey),
    revenue: roundRub(revenue),
    cash: roundRub(cash),
    acquiringGross: roundRub(acquiringGross),
    acquiringRatePercent,
    acquiringFee: roundRub(acquiringFee),
    acquiringNet: roundRub(acquiringNet),
    transfer: roundRub(transfer),
    salariesTotal: roundRub(salariesTotal),
    salesSalariesTotal: roundRub(salesSalariesTotal),
    checksCount: storeSales.length,
    unitsSold: roundRub(unitsSold),
    sellers: sellersWithTier,
    products,
    manager: managerBlock,
    retoucher: retoucherBlock,
    shiftLabel,
    deletedSales,
    generatedAt: new Date().toLocaleString('ru-RU'),
  };
}

function fillRange(sheet: ExcelJS.Worksheet, range: string, fillArgb: string) {
  const [start, end] = range.split(':');
  const startCell = sheet.getCell(start);
  const endCell = sheet.getCell(end ?? start);
  for (let r = Number(startCell.row); r <= Number(endCell.row); r += 1) {
    for (let c = Number(startCell.col); c <= Number(endCell.col); c += 1) {
      sheet.getCell(r, c).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: fillArgb },
      };
    }
  }
}

function borderRange(sheet: ExcelJS.Worksheet, range: string, color = C.border) {
  const [start, end] = range.split(':');
  const startCell = sheet.getCell(start);
  const endCell = sheet.getCell(end ?? start);
  for (let r = Number(startCell.row); r <= Number(endCell.row); r += 1) {
    for (let c = Number(startCell.col); c <= Number(endCell.col); c += 1) {
      sheet.getCell(r, c).border = {
        top: { style: 'thin', color: { argb: color } },
        left: { style: 'thin', color: { argb: color } },
        bottom: { style: 'thin', color: { argb: color } },
        right: { style: 'thin', color: { argb: color } },
      };
    }
  }
}

function rubPlain(value: number): string {
  return `${value} ₽`;
}

function rubCell(
  cell: ExcelJS.Cell,
  value: number,
  options?: { color?: string; bold?: boolean; size?: number; align?: 'left' | 'right' | 'center' },
) {
  cell.value = value;
  cell.numFmt = '0" ₽"';
  cell.font = {
    bold: options?.bold ?? true,
    size: options?.size ?? 12,
    color: { argb: options?.color ?? C.rowText },
  };
  cell.alignment = { horizontal: options?.align ?? 'right', vertical: 'middle' };
}

function addHeroBlock(
  sheet: ExcelJS.Worksheet,
  range: string,
  label: string,
  value: number,
  blockColor: string,
) {
  const [start] = range.split(':');
  const startCell = sheet.getCell(start);
  const row = Number(startCell.row);
  const col = Number(startCell.col);
  const endCol = Number(sheet.getCell(range.split(':')[1] ?? start).col);
  const endRow = row + 1;
  sheet.mergeCells(row, col, endRow, endCol);
  fillRange(sheet, range, blockColor);
  borderRange(sheet, range, C.border);

  const inner = sheet.getCell(row, col);
  inner.value = {
    richText: [
      { text: `${label}\n`, font: { size: 9, color: { argb: C.onColorLabel } } },
      { text: rubPlain(value), font: { bold: true, size: 20, color: { argb: C.onColorValue } } },
    ],
  };
  inner.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  sheet.getRow(row).height = 14;
  sheet.getRow(row + 1).height = 24;
}

function addMiniStaffBlock(
  sheet: ExcelJS.Worksheet,
  range: string,
  title: string,
  block: StoreDayReportStaffBlock,
  blockColor: string,
) {
  const [start] = range.split(':');
  const startCell = sheet.getCell(start);
  const row = Number(startCell.row);
  const col = Number(startCell.col);
  const endCol = Number(sheet.getCell(range.split(':')[1] ?? start).col);
  const addr = `${sheet.getCell(row, col).address}:${sheet.getCell(row + 1, endCol).address}`;
  sheet.mergeCells(row, col, row, endCol);
  sheet.mergeCells(row + 1, col, row + 1, endCol);
  fillRange(sheet, addr, blockColor);
  borderRange(sheet, addr, C.border);

  const titleCell = sheet.getCell(row, col);
  titleCell.value = `${title} · ${block.name}`;
  titleCell.font = { size: 8, color: { argb: C.onColorLabel } };
  titleCell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1, wrapText: true };

  const payCell = sheet.getCell(row + 1, col);
  payCell.value = rubPlain(block.salaryRub);
  payCell.font = { bold: true, size: 14, color: { argb: C.onColorValue } };
  payCell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
  if (block.hint) {
    payCell.note = block.hint;
  }
  sheet.getRow(row).height = 15;
  sheet.getRow(row + 1).height = 20;
}

function addPayKpi(
  sheet: ExcelJS.Worksheet,
  col: number,
  row: number,
  label: string,
  value: number,
  blockColor: string,
  span = 2,
) {
  const endCol = col + span - 1;
  sheet.mergeCells(row, col, row, endCol);
  sheet.mergeCells(row + 1, col, row + 1, endCol);
  const range = `${sheet.getCell(row, col).address}:${sheet.getCell(row + 1, endCol).address}`;
  fillRange(sheet, range, blockColor);
  borderRange(sheet, range, C.border);

  const labelCell = sheet.getCell(row, col);
  labelCell.value = label;
  labelCell.font = { size: 8, color: { argb: C.onColorLabel } };
  labelCell.alignment = { horizontal: 'center', vertical: 'bottom', wrapText: true };

  const valueCell = sheet.getCell(row + 1, col);
  valueCell.value = rubPlain(value);
  valueCell.font = { bold: true, size: 13, color: { argb: C.onColorValue } };
  valueCell.alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(row).height = 13;
  sheet.getRow(row + 1).height = 20;
}

function styleSellerRow(
  sheet: ExcelJS.Worksheet,
  rowNum: number,
  tier: StoreDayReportSellerRow['tier'],
  sellerName?: string,
) {
  let bg = rowNum % 2 === 0 ? C.rowNormalA : C.rowNormalB;
  let textColor = C.rowText;
  let accentColor = C.border;
  if (tier === 'best') {
    bg = C.rowBest;
    textColor = C.rowBestText;
    accentColor = C.rowBestAccent;
  } else if (tier === 'top3') {
    bg = C.rowTop3;
    textColor = C.rowTop3Text;
    accentColor = C.rowTop3Accent;
  } else if (tier === 'zero') {
    bg = C.rowZero;
    textColor = C.rowZeroText;
  }
  for (let col = 1; col <= 3; col += 1) {
    const cell = sheet.getCell(rowNum, col);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
    const isBold = tier === 'best' || tier === 'top3' || (cell.font?.bold ?? false);
    cell.font = {
      ...(cell.font ?? {}),
      bold: tier === 'best' ? true : isBold,
      color: { argb: textColor },
    };
    cell.border = {
      top: { style: tier === 'best' ? 'medium' : 'thin', color: { argb: tier === 'best' ? accentColor : C.border } },
      bottom: { style: tier === 'best' ? 'medium' : 'thin', color: { argb: tier === 'best' ? accentColor : C.border } },
      right: { style: 'thin', color: { argb: C.border } },
      left:
        col === 1
          ? { style: tier === 'best' ? 'thick' : tier === 'top3' ? 'medium' : 'thin', color: { argb: accentColor } }
          : { style: 'thin', color: { argb: C.border } },
    };
    if (col === 1) {
      cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true, indent: 0 };
      if (tier === 'best' && sellerName) {
        cell.value = {
          richText: [
            { text: '★ Лидер · ', font: { bold: true, size: 9, color: { argb: 'FFFFE8B0' } } },
            { text: sellerName, font: { bold: true, size: 10, color: { argb: textColor } } },
          ],
        };
      }
    }
  }
}

function addPaymentMixBlock(sheet: ExcelJS.Worksheet, startRow: number, data: StoreDayReportData) {
  const items = [
    { label: 'Наличные', value: data.cash, color: C.blockCash },
    { label: 'Эквайринг', value: data.acquiringGross, color: C.blockAcq },
    { label: 'Переводы', value: data.transfer, color: C.blockTransfer },
  ].filter((item) => item.value > 0);

  sheet.mergeCells(startRow, 9, startRow, 12);
  const title = sheet.getCell(startRow, 9);
  title.value = 'Структура оплат';
  title.font = { bold: true, size: 9, color: { argb: C.sectionText } };
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.sectionBg } };
  title.alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(startRow).height = 15;

  const softByLabel: Record<string, string> = {
    Наличные: C.blockCashSoft,
    Эквайринг: C.blockAcqSoft,
    Переводы: C.blockTransferSoft,
  };
  const accentByLabel: Record<string, string> = {
    Наличные: C.blockCash,
    Эквайринг: C.blockAcq,
    Переводы: C.blockTransfer,
  };

  items.forEach((item, idx) => {
    const row = startRow + 1 + idx;
    sheet.mergeCells(row, 9, row, 10);
    sheet.mergeCells(row, 11, row, 12);
    const share = pct(item.value, data.revenue);
    const softBg = softByLabel[item.label] ?? C.rowNormalB;
    const accent = accentByLabel[item.label] ?? C.blockRevenue;

    const labelCell = sheet.getCell(row, 9);
    labelCell.value = item.label;
    labelCell.font = { size: 9, color: { argb: C.rowText } };
    labelCell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };

    const valueCell = sheet.getCell(row, 11);
    valueCell.value = `${rubPlain(item.value)} · ${share}%`;
    valueCell.font = { bold: true, size: 9, color: { argb: accent } };
    valueCell.alignment = { horizontal: 'right', vertical: 'middle' };

    fillRange(sheet, `I${row}:L${row}`, softBg);
    borderRange(sheet, `I${row}:L${row}`);
    sheet.getCell(row, 9).border = {
      ...sheet.getCell(row, 9).border,
      left: { style: 'medium', color: { argb: accent } },
    };
    sheet.getRow(row).height = 14;
  });

  if (data.acquiringFee > 0) {
    const footRow = startRow + 1 + items.length;
    sheet.mergeCells(footRow, 9, footRow, 12);
    const foot = sheet.getCell(footRow, 9);
    foot.value = `комиссия ${data.acquiringRatePercent}%: ${rubPlain(data.acquiringFee)}`;
    foot.font = { size: 7, color: { argb: C.muted } };
    foot.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.rowNormalB } };
    foot.alignment = { horizontal: 'center', vertical: 'middle' };
    borderRange(sheet, `I${footRow}:L${footRow}`, C.border);
    sheet.getRow(footRow).height = 12;
  }
}

function addDeletedSalesSidePanel(
  sheet: ExcelJS.Worksheet,
  tableHeaderRow: number,
  colHeaderRow: number,
  tableRows: number,
  rows: StoreDayReportDeletedSaleRow[],
): void {
  sheet.mergeCells(tableHeaderRow, 9, tableHeaderRow, 12);
  const title = sheet.getCell(tableHeaderRow, 9);
  title.value = 'Удалённые продажи';
  title.font = { bold: true, size: 10, color: { argb: C.sectionText } };
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.sectionBg } };
  title.alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(tableHeaderRow).height = 17;

  sheet.getCell(colHeaderRow, 9).value = 'Продавец';
  sheet.mergeCells(colHeaderRow, 10, colHeaderRow, 11);
  sheet.getCell(colHeaderRow, 10).value = 'Сумма';
  sheet.getCell(colHeaderRow, 12).value = 'Причина';
  for (const col of [9, 10, 12]) {
    const cell = sheet.getCell(colHeaderRow, col);
    cell.font = { bold: true, size: 9, color: { argb: C.headerText } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.headerBg } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  }
  sheet.getRow(colHeaderRow).height = 16;

  const bodyRows = Math.max(tableRows, rows.length > 0 ? rows.length : 1);
  let totalDeleted = 0;

  for (let i = 0; i < bodyRows; i += 1) {
    const rowNum = colHeaderRow + 1 + i;
    const entry = rows[i];
    const bg = i % 2 === 0 ? C.rowNormalA : C.rowNormalB;

    if (entry) {
      sheet.getCell(rowNum, 9).value = entry.sellerName;
      rubCell(sheet.getCell(rowNum, 10), entry.amount, { color: C.rowText, size: 9 });
      sheet.mergeCells(rowNum, 10, rowNum, 11);
      sheet.getCell(rowNum, 12).value = entry.reason;
      totalDeleted += entry.amount;
    } else if (rows.length === 0 && i === 0) {
      sheet.mergeCells(rowNum, 9, rowNum, 12);
      sheet.getCell(rowNum, 9).value = 'Нет удалённых продаж';
      sheet.getCell(rowNum, 9).font = { size: 9, color: { argb: C.muted } };
      sheet.getCell(rowNum, 9).alignment = { horizontal: 'center', vertical: 'middle' };
    }

    fillRange(sheet, `I${rowNum}:L${rowNum}`, bg);
    borderRange(sheet, `I${rowNum}:L${rowNum}`);
    if (entry) {
      for (const col of [9, 10, 12]) {
        const cell = sheet.getCell(rowNum, col);
        cell.font = { size: 9, color: { argb: C.rowText } };
        cell.alignment = {
          horizontal: col === 12 ? 'left' : 'center',
          vertical: 'middle',
          wrapText: true,
        };
      }
    }
    sheet.getRow(rowNum).height = entry ? 16 : 14;
  }

  if (rows.length > 0) {
    const totalRow = colHeaderRow + 1 + bodyRows;
    sheet.mergeCells(totalRow, 9, totalRow, 11);
    sheet.getCell(totalRow, 9).value = 'Итого';
    sheet.getCell(totalRow, 9).font = { bold: true, size: 9, color: { argb: C.totalText } };
    rubCell(sheet.getCell(totalRow, 10), totalDeleted, {
      color: C.totalText,
      size: 9,
      bold: true,
    });
    sheet.getCell(totalRow, 12).value = `${rows.length} шт.`;
    sheet.getCell(totalRow, 12).font = { bold: true, size: 9, color: { argb: C.totalText } };
    fillRange(sheet, `I${totalRow}:L${totalRow}`, C.totalBg);
    borderRange(sheet, `I${totalRow}:L${totalRow}`, C.borderDark);
    sheet.getRow(totalRow).height = 15;
  }
}

export async function downloadStoreDayReportXlsx(data: StoreDayReportData): Promise<SaveXlsxResult> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Фотографы';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Отчёт за день', {
    views: [{ showGridLines: false }],
  });

  sheet.columns = [
    { width: 28 },
    { width: 10 },
    { width: 10 },
    { width: 1.5 },
    { width: 22 },
    { width: 8 },
    { width: 1.5 },
    { width: 1.5 },
    { width: 10 },
    { width: 10 },
    { width: 10 },
    { width: 10 },
  ];

  fillRange(sheet, 'A1:L40', C.pageBg);

  sheet.mergeCells('A1:F1');
  const title = sheet.getCell('A1');
  title.value = 'Отчёт за день';
  title.font = { bold: true, size: 18, color: { argb: C.heroText } };
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.heroDark } };
  title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  sheet.getRow(1).height = 28;

  sheet.mergeCells('G1:L1');
  const dateTitle = sheet.getCell('G1');
  dateTitle.value = data.dayLabel;
  dateTitle.font = { bold: true, size: 22, color: { argb: C.onColorValue } };
  dateTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.blockRevenue } };
  dateTitle.alignment = { vertical: 'middle', horizontal: 'center' };

  sheet.mergeCells('A2:L2');
  const subtitle = sheet.getCell('A2');
  subtitle.value = `${data.storeName} · ${data.shiftLabel ?? ''} · ${data.generatedAt}`;
  subtitle.font = { size: 8, color: { argb: C.heroMuted } };
  subtitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.heroMid } };
  subtitle.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  sheet.getRow(2).height = 15;
  borderRange(sheet, 'A1:L2', C.borderDark);

  addHeroBlock(sheet, 'A3:D4', 'Общая касса', data.revenue, C.blockRevenue);
  addHeroBlock(sheet, 'I3:L4', 'ЗП за день', data.salariesTotal, C.blockSalary);

  addPayKpi(sheet, 1, 5, 'Наличные', data.cash, C.blockCash, 2);
  addPayKpi(sheet, 3, 5, 'Эквайринг', data.acquiringGross, C.blockAcq, 2);
  addPayKpi(sheet, 5, 5, 'Нетто', data.acquiringNet, C.blockAcqNet, 2);
  addPayKpi(sheet, 7, 5, 'Переводы', data.transfer, C.blockTransfer, 4);
  addPayKpi(sheet, 11, 5, 'ЗП продавцов', data.salesSalariesTotal, C.blockSalesPay, 2);

  // Строка 6 занята KPI (addPayKpi row+1) — персонал и структура оплат только с 7-й.
  const staffRow = 7;
  if (data.manager) {
    addMiniStaffBlock(
      sheet,
      `A${staffRow}:C${staffRow + 1}`,
      'Управляющий',
      data.manager,
      C.blockManager,
    );
  }
  if (data.retoucher) {
    addMiniStaffBlock(
      sheet,
      `E${staffRow}:G${staffRow + 1}`,
      'Ретушёр',
      data.retoucher,
      C.blockRetoucher,
    );
  }
  addPaymentMixBlock(sheet, staffRow, data);

  const paymentMixRows =
    1 +
    [data.cash, data.acquiringGross, data.transfer].filter((v) => v > 0).length +
    (data.acquiringFee > 0 ? 1 : 0);
  const tableHeaderRow = staffRow + Math.max(2, paymentMixRows) + 1;
  sheet.mergeCells(`A${tableHeaderRow}:C${tableHeaderRow}`);
  sheet.getCell(`A${tableHeaderRow}`).value = 'Продавцы';
  sheet.mergeCells(`E${tableHeaderRow}:F${tableHeaderRow}`);
  sheet.getCell(`E${tableHeaderRow}`).value = 'Проданные товары';
  for (const addr of [`A${tableHeaderRow}`, `E${tableHeaderRow}`]) {
    const cell = sheet.getCell(addr);
    cell.font = { bold: true, size: 10, color: { argb: C.sectionText } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.sectionBg } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  }
  sheet.getRow(tableHeaderRow).height = 17;

  const colHeaderRow = tableHeaderRow + 1;
  const sellerHeaders = ['Сотрудник', 'Продажи', 'ЗП'];
  sellerHeaders.forEach((label, idx) => {
    const cell = sheet.getCell(colHeaderRow, idx + 1);
    cell.value = label;
    cell.font = { bold: true, size: 9, color: { argb: C.headerText } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.headerBg } };
    cell.alignment = { horizontal: idx === 0 ? 'left' : 'center', vertical: 'middle' };
  });
  const productHeaders = ['Товар', 'Кол-во'];
  productHeaders.forEach((label, idx) => {
    const cell = sheet.getCell(colHeaderRow, idx + 5);
    cell.value = label;
    cell.font = { bold: true, size: 9, color: { argb: C.headerText } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.headerBg } };
    cell.alignment = { horizontal: idx === 0 ? 'left' : 'center', vertical: 'middle' };
  });
  sheet.getRow(colHeaderRow).height = 16;

  const tableRows = Math.max(data.sellers.length, data.products.length, 1);
  addDeletedSalesSidePanel(
    sheet,
    tableHeaderRow,
    colHeaderRow,
    tableRows,
    data.deletedSales ?? [],
  );
  let totalSales = 0;
  let totalSellerSalary = 0;
  let totalQty = 0;

  for (let i = 0; i < tableRows; i += 1) {
    const rowNum = colHeaderRow + 1 + i;
    const seller = data.sellers[i];
    const product = data.products[i];

    if (seller) {
      sheet.getCell(rowNum, 1).value = seller.name;
      const moneyColor = seller.tier === 'best' ? C.rowBestText : C.rowText;
      rubCell(sheet.getCell(rowNum, 2), seller.salesRub, {
        color: moneyColor,
        bold: seller.tier !== 'zero',
        size: seller.tier === 'best' ? 10 : 9,
      });
      rubCell(sheet.getCell(rowNum, 3), seller.salaryRub, {
        color: moneyColor,
        bold: seller.tier !== 'zero',
        size: seller.tier === 'best' ? 10 : 9,
      });
      styleSellerRow(sheet, rowNum, seller.tier, seller.name);
      totalSales += seller.salesRub;
      totalSellerSalary += seller.salaryRub;
    }

    if (product) {
      const bg = i % 2 === 0 ? C.rowNormalA : C.rowNormalB;
      sheet.getCell(rowNum, 5).value = product.name;
      sheet.getCell(rowNum, 6).value = product.qty;
      for (let col = 5; col <= 6; col += 1) {
        const cell = sheet.getCell(rowNum, col);
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
        cell.font = { color: { argb: C.rowText }, size: 9 };
        if (col === 5) {
          cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
        } else {
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        }
      }
      borderRange(sheet, `E${rowNum}:F${rowNum}`);
      totalQty += product.qty;
    }
    sheet.getRow(rowNum).height = seller?.tier === 'best' ? 20 : 15;
  }

  const totalRow = colHeaderRow + 1 + tableRows;
  const totalLabel = sheet.getCell(totalRow, 1);
  totalLabel.value = 'ИТОГО';
  totalLabel.font = { bold: true, size: 10, color: { argb: C.totalText } };
  totalLabel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.totalBg } };
  totalLabel.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };

  rubCell(sheet.getCell(totalRow, 2), totalSales, { color: C.totalText, size: 11 });
  rubCell(sheet.getCell(totalRow, 3), totalSellerSalary, { color: C.totalText, size: 11 });
  sheet.getCell(totalRow, 2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.totalBg } };
  sheet.getCell(totalRow, 3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.totalBg } };
  borderRange(sheet, `A${totalRow}:C${totalRow}`, C.borderDark);

  sheet.getCell(totalRow, 5).value = 'ИТОГО';
  sheet.getCell(totalRow, 5).font = { bold: true, size: 10, color: { argb: C.totalText } };
  sheet.getCell(totalRow, 5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.totalBg } };
  sheet.getCell(totalRow, 6).value = totalQty;
  sheet.getCell(totalRow, 6).font = { bold: true, size: 10, color: { argb: C.totalText } };
  sheet.getCell(totalRow, 6).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.totalBg } };
  sheet.getCell(totalRow, 6).alignment = { horizontal: 'center', vertical: 'middle' };
  borderRange(sheet, `E${totalRow}:F${totalRow}`, C.borderDark);
  sheet.getRow(totalRow).height = 17;

  const summaryRow = totalRow + 1;
  sheet.mergeCells(`A${summaryRow}:L${summaryRow}`);
  const summaryTitle = sheet.getCell(`A${summaryRow}`);
  summaryTitle.value = 'Сводка по видам оплаты';
  summaryTitle.font = { bold: true, size: 10, color: { argb: C.sectionText } };
  summaryTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.sectionBg } };
  summaryTitle.alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(summaryRow).height = 16;

  const payRow = summaryRow + 1;
  const payLines = [
    ['Наличные', data.cash, 'В кассе точки'],
    [
      'Эквайринг',
      data.acquiringGross,
      `Комиссия ${data.acquiringRatePercent}% (−${rubPlain(data.acquiringFee)}) → нетто ${rubPlain(data.acquiringNet)}`,
    ],
    ['Переводы', data.transfer, 'Безнал переводом'],
  ];
  payLines.forEach((line, idx) => {
    const row = payRow + idx;
    sheet.mergeCells(row, 1, row, 3);
    sheet.mergeCells(row, 4, row, 6);
    sheet.mergeCells(row, 7, row, 12);
    sheet.getCell(row, 1).value = line[0];
    rubCell(sheet.getCell(row, 4), line[1] as number, { color: C.rowText, size: 10 });
    sheet.getCell(row, 7).value = line[2];
    sheet.getCell(row, 7).font = { size: 9, color: { argb: C.muted } };
    sheet.getCell(row, 1).font = { size: 10, color: { argb: C.rowText } };
    const bg = idx % 2 === 0 ? C.rowNormalA : C.rowNormalB;
    fillRange(sheet, `A${row}:L${row}`, bg);
    borderRange(sheet, `A${row}:L${row}`);
    sheet.getRow(row).height = 14;
  });

  let footerRow = payRow + payLines.length;

  sheet.mergeCells(`A${footerRow}:L${footerRow}`);
  const footerParts = [
    `Чеков: ${data.checksCount}`,
    `Единиц товара: ${data.unitsSold}`,
    `Доля наличных: ${pct(data.cash, data.revenue)}%`,
  ];
  if (data.manager) {
    footerParts.push(`Управляющий: ${rubPlain(data.manager.salaryRub)}`);
  }
  if (data.retoucher) {
    footerParts.push(`Ретушёр: ${rubPlain(data.retoucher.salaryRub)}`);
  }
  if (data.deletedSales && data.deletedSales.length > 0) {
    footerParts.push(`Удалено продаж: ${data.deletedSales.length}`);
  }
  const footerCell = sheet.getCell(`A${footerRow}`);
  footerCell.value = footerParts.join(' · ');
  footerCell.font = { size: 8, color: { argb: C.muted } };
  footerCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.rowNormalB } };
  footerCell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
  borderRange(sheet, `A${footerRow}:L${footerRow}`, C.border);

  applyDayReportPrintSetup(sheet, footerRow);

  const safeStore = data.storeName.replace(/[^\wа-яА-ЯёЁ.-]+/gi, '_').slice(0, 40);
  const buffer = await workbook.xlsx.writeBuffer();
  return saveXlsxFile(buffer, `otchet-den-${safeStore}-${data.dayKey}.xlsx`);
}

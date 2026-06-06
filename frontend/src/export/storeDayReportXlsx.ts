import ExcelJS from 'exceljs';
import { percentForStore, type AcquiringProfile } from '../acquiring/acquiringConfig';
import { DEFAULT_MANAGER_STORE_COMMISSIONS } from '../inventory/normalizeInventoryOverview';

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

const C = {
  pageBg: 'FF0B1218',
  heroDark: 'FF111827',
  heroMid: 'FF1F2937',
  heroText: 'FFF9FAFB',
  heroMuted: 'FF9CA3AF',
  blockRevenue: 'FF0E7490',
  blockSalary: 'FFB45309',
  blockManager: 'FF92400E',
  blockRetoucher: 'FF1D4ED8',
  blockCash: 'FF0369A1',
  blockAcq: 'FF4F46E5',
  blockAcqNet: 'FF047857',
  blockTransfer: 'FFC2410C',
  blockFee: 'FF374151',
  blockSalesPay: 'FFA16207',
  sectionBg: 'FF111827',
  sectionText: 'FFF3F4F6',
  headerBg: 'FF1F2937',
  headerText: 'FFE5E7EB',
  rowNormalA: 'FF1A2332',
  rowNormalB: 'FF151D2B',
  rowText: 'FFE5E7EB',
  rowBest: 'FFB45309',
  rowBestText: 'FFFFFFFF',
  rowTop3: 'FF1D4ED8',
  rowTop3Text: 'FFFFFFFF',
  rowZero: 'FF374151',
  rowZeroText: 'FF9CA3AF',
  totalBg: 'FF111827',
  totalText: 'FFFDE68A',
  border: 'FF374151',
  borderDark: 'FF1F2937',
  muted: 'FF9CA3AF',
};

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

function downloadBuffer(buffer: ArrayBuffer, filename: string) {
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
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
  const endRow = row + 2;
  sheet.mergeCells(row, col, endRow, endCol);
  fillRange(sheet, range, blockColor);
  borderRange(sheet, range, C.border);

  const inner = sheet.getCell(row, col);
  inner.value = {
    richText: [
      { text: `${label}\n`, font: { size: 10, color: { argb: 'FFE5E7EB' } } },
      { text: rubPlain(value), font: { bold: true, size: 24, color: { argb: 'FFFFFFFF' } } },
    ],
  };
  inner.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  sheet.getRow(row).height = 18;
  sheet.getRow(row + 1).height = 26;
  sheet.getRow(row + 2).height = 26;
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
  const addr = `${sheet.getCell(row, col).address}:${sheet.getCell(row + 2, endCol).address}`;
  sheet.mergeCells(row, col, row, endCol);
  sheet.mergeCells(row + 1, col, row + 1, endCol);
  sheet.mergeCells(row + 2, col, row + 2, endCol);
  fillRange(sheet, addr, blockColor);
  borderRange(sheet, addr, C.border);

  const titleCell = sheet.getCell(row, col);
  titleCell.value = title;
  titleCell.font = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } };
  titleCell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };

  const nameCell = sheet.getCell(row + 1, col);
  nameCell.value = block.name;
  nameCell.font = { size: 8, color: { argb: 'FFE5E7EB' } };
  nameCell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1, wrapText: true };

  const payCell = sheet.getCell(row + 2, col);
  payCell.value = rubPlain(block.salaryRub);
  payCell.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
  payCell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
  if (block.hint) {
    payCell.note = block.hint;
  }
  sheet.getRow(row).height = 16;
  sheet.getRow(row + 1).height = 18;
  sheet.getRow(row + 2).height = 24;
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
  labelCell.font = { size: 8, color: { argb: 'FFE5E7EB' } };
  labelCell.alignment = { horizontal: 'center', vertical: 'bottom', wrapText: true };

  const valueCell = sheet.getCell(row + 1, col);
  valueCell.value = rubPlain(value);
  valueCell.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
  valueCell.alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(row).height = 16;
  sheet.getRow(row + 1).height = 24;
}

function styleSellerRow(sheet: ExcelJS.Worksheet, rowNum: number, tier: StoreDayReportSellerRow['tier']) {
  let bg = rowNum % 2 === 0 ? C.rowNormalA : C.rowNormalB;
  let textColor = C.rowText;
  if (tier === 'best') {
    bg = C.rowBest;
    textColor = C.rowBestText;
  } else if (tier === 'top3') {
    bg = C.rowTop3;
    textColor = C.rowTop3Text;
  } else if (tier === 'zero') {
    bg = C.rowZero;
    textColor = C.rowZeroText;
  }
  for (let col = 1; col <= 3; col += 1) {
    const cell = sheet.getCell(rowNum, col);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
    cell.font = { ...(cell.font ?? {}), color: { argb: textColor } };
    if (col === 1) {
      cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true, indent: tier === 'best' ? 1 : 0 };
      if (tier === 'best') {
        cell.value = `★ ${String(cell.value ?? '')}`;
      }
    }
  }
  borderRange(sheet, `A${rowNum}:C${rowNum}`, C.border);
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
  sheet.getRow(startRow).height = 18;

  items.forEach((item, idx) => {
    const row = startRow + 1 + idx;
    sheet.mergeCells(row, 9, row, 10);
    sheet.mergeCells(row, 11, row, 12);
    const share = pct(item.value, data.revenue);

    const labelCell = sheet.getCell(row, 9);
    labelCell.value = item.label;
    labelCell.font = { size: 9, color: { argb: C.rowText } };
    labelCell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };

    const valueCell = sheet.getCell(row, 11);
    valueCell.value = `${rubPlain(item.value)} · ${share}%`;
    valueCell.font = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } };
    valueCell.alignment = { horizontal: 'right', vertical: 'middle' };

    fillRange(sheet, `I${row}:J${row}`, item.color);
    fillRange(sheet, `K${row}:L${row}`, item.color);
    borderRange(sheet, `I${row}:L${row}`);
    sheet.getRow(row).height = 18;
  });

  if (data.acquiringFee > 0) {
    const footRow = startRow + 1 + items.length;
    sheet.mergeCells(footRow, 9, footRow, 12);
    const foot = sheet.getCell(footRow, 9);
    foot.value = `комиссия ${data.acquiringRatePercent}%: ${rubPlain(data.acquiringFee)}`;
    foot.font = { size: 8, color: { argb: C.muted } };
    foot.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.heroMid } };
    foot.alignment = { horizontal: 'center', vertical: 'middle' };
    borderRange(sheet, `I${footRow}:L${footRow}`, C.borderDark);
    sheet.getRow(footRow).height = 14;
  }
}

export async function downloadStoreDayReportXlsx(data: StoreDayReportData) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Фотографы';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Отчёт за день', {
    views: [{ showGridLines: false }],
    pageSetup: {
      paperSize: 9,
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 1,
      margins: {
        left: 0.35,
        right: 0.35,
        top: 0.45,
        bottom: 0.45,
        header: 0.2,
        footer: 0.2,
      },
    },
  });

  sheet.columns = [
    { width: 16 },
    { width: 11 },
    { width: 11 },
    { width: 3 },
    { width: 20 },
    { width: 9 },
    { width: 3 },
    { width: 3 },
    { width: 11 },
    { width: 11 },
    { width: 11 },
    { width: 11 },
  ];

  fillRange(sheet, 'A1:L45', C.pageBg);

  sheet.mergeCells('A1:F1');
  const title = sheet.getCell('A1');
  title.value = 'Отчёт за день';
  title.font = { bold: true, size: 20, color: { argb: C.heroText } };
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.heroDark } };
  title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  sheet.getRow(1).height = 36;

  sheet.mergeCells('G1:L1');
  const dateTitle = sheet.getCell('G1');
  dateTitle.value = data.dayLabel;
  dateTitle.font = { bold: true, size: 28, color: { argb: 'FFFFFFFF' } };
  dateTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.blockRevenue } };
  dateTitle.alignment = { vertical: 'middle', horizontal: 'center' };

  sheet.mergeCells('A2:L2');
  const subtitle = sheet.getCell('A2');
  subtitle.value = `${data.storeName} · ${data.shiftLabel ?? ''} · сформирован ${data.generatedAt}`;
  subtitle.font = { size: 9, color: { argb: C.heroMuted } };
  subtitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.heroMid } };
  subtitle.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  sheet.getRow(2).height = 18;

  addHeroBlock(sheet, 'A4:D6', 'Общая касса', data.revenue, C.blockRevenue);
  addHeroBlock(sheet, 'I4:L6', 'ЗП за день', data.salariesTotal, C.blockSalary);

  addPayKpi(sheet, 1, 8, 'Наличные', data.cash, C.blockCash, 2);
  addPayKpi(sheet, 3, 8, 'Эквайринг', data.acquiringGross, C.blockAcq, 2);
  addPayKpi(sheet, 5, 8, 'Нетто', data.acquiringNet, C.blockAcqNet, 2);
  addPayKpi(sheet, 7, 8, 'Переводы', data.transfer, C.blockTransfer, 4);
  addPayKpi(sheet, 11, 8, 'ЗП продавцов', data.salesSalariesTotal, C.blockSalesPay, 2);

  if (data.manager) {
    addMiniStaffBlock(sheet, 'A11:C13', 'Управляющий', data.manager, C.blockManager);
  }
  if (data.retoucher) {
    addMiniStaffBlock(sheet, 'E11:G13', 'Ретушёр', data.retoucher, C.blockRetoucher);
  }
  addPaymentMixBlock(sheet, 11, data);

  const tableHeaderRow = 15;
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
  sheet.getRow(tableHeaderRow).height = 22;

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
  sheet.getRow(colHeaderRow).height = 20;

  const tableRows = Math.max(data.sellers.length, data.products.length, 1);
  let totalSales = 0;
  let totalSellerSalary = 0;
  let totalQty = 0;

  for (let i = 0; i < tableRows; i += 1) {
    const rowNum = colHeaderRow + 1 + i;
    const seller = data.sellers[i];
    const product = data.products[i];

    if (seller) {
      sheet.getCell(rowNum, 1).value = seller.name;
      rubCell(sheet.getCell(rowNum, 2), seller.salesRub, {
        color: C.rowText,
        bold: seller.tier !== 'zero',
        size: 11,
      });
      rubCell(sheet.getCell(rowNum, 3), seller.salaryRub, {
        color: C.rowText,
        bold: seller.tier !== 'zero',
        size: 11,
      });
      styleSellerRow(sheet, rowNum, seller.tier);
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
        cell.font = { color: { argb: C.rowText }, size: 10 };
        if (col === 5) {
          cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
        } else {
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        }
      }
      borderRange(sheet, `E${rowNum}:F${rowNum}`);
      totalQty += product.qty;
    }
    sheet.getRow(rowNum).height = 18;
  }

  const totalRow = colHeaderRow + 1 + tableRows;
  sheet.mergeCells(`A${totalRow}:A${totalRow}`);
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
  sheet.getRow(totalRow).height = 22;

  const summaryRow = totalRow + 2;
  sheet.mergeCells(`A${summaryRow}:L${summaryRow}`);
  const summaryTitle = sheet.getCell(`A${summaryRow}`);
  summaryTitle.value = 'Сводка по видам оплаты';
  summaryTitle.font = { bold: true, size: 10, color: { argb: C.sectionText } };
  summaryTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.sectionBg } };
  summaryTitle.alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(summaryRow).height = 20;

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
    sheet.getRow(row).height = 17;
  });

  const footerRow = payRow + 4;
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
  sheet.getCell(`A${footerRow}`).value = footerParts.join(' · ');
  sheet.getCell(`A${footerRow}`).font = { size: 8, color: { argb: C.muted } };
  sheet.getCell(`A${footerRow}`).alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };

  sheet.pageSetup.printArea = `A1:L${footerRow}`;

  const safeStore = data.storeName.replace(/[^\wа-яА-ЯёЁ.-]+/gi, '_').slice(0, 40);
  const buffer = await workbook.xlsx.writeBuffer();
  downloadBuffer(buffer, `otchet-den-${safeStore}-${data.dayKey}.xlsx`);
}

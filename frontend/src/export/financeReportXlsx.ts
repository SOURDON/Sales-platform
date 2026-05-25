import ExcelJS from 'exceljs';

export type FinanceReportExportRow = {
  storeName: string;
  planRevenue: number;
  revenue: number;
  cashRevenue: number;
  nonCashRevenue: number;
  transferRevenue: number;
  goodsSpent: number;
  salaries: number;
  acquiringFee: number;
  profitWithoutGoods: number;
  profitWithGoods: number;
};

export type FinanceReportExportTotals = {
  planRevenue: number;
  revenue: number;
  cashRevenue: number;
  nonCashRevenue: number;
  transferRevenue: number;
  goodsSpent: number;
  salaries: number;
  profitWithoutGoods: number;
  profitWithGoods: number;
  acquiringFee: number;
};

const C = {
  headerBg: 'FF1A3228',
  headerText: 'FFE8D9A8',
  titleBg: 'FF0E1814',
  titleText: 'FFC4A56D',
  totalBg: 'FF2A2418',
  totalText: 'FFC4A56D',
  zebraA: 'FFFFFFFF',
  zebraB: 'FFF4F7F5',
  border: 'FFD0D9D4',
  green: 'FFA67C32',
  greenLight: 'FFF5EDD8',
  red: 'FFC0392B',
  redLight: 'FFFDECEA',
  muted: 'FF5C6B64',
  chartPlan: 'FF94A3B8',
  chartFact: 'FFA67C32',
  chartProfit: 'FFC4A56D',
};

function roundRub(n: number): number {
  return Math.round(n);
}

function pct(part: number, whole: number): number {
  if (whole <= 0) {
    return 0;
  }
  return Math.round((part / whole) * 1000) / 10;
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

function truncateLabel(name: string, max = 18): string {
  const t = name.trim();
  if (t.length <= max) {
    return t;
  }
  return `${t.slice(0, max - 1)}…`;
}

/** Простой столбчатый график → PNG для вставки в Excel */
function renderGroupedBarChartPng(options: {
  title: string;
  categories: string[];
  series: Array<{ name: string; color: string; values: number[] }>;
  width?: number;
  height?: number;
}): string {
  const width = options.width ?? 920;
  const height = options.height ?? 420;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return '';
  }

  const pad = { top: 52, right: 24, bottom: 88, left: 56 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#1a3228';
  ctx.font = 'bold 16px system-ui, sans-serif';
  ctx.fillText(options.title, pad.left, 30);

  const allValues = options.series.flatMap((s) => s.values);
  const maxVal = Math.max(1, ...allValues, 0);
  const yMax = maxVal * 1.12;

  ctx.strokeStyle = '#e2e8e4';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (plotH * i) / 4;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + plotW, y);
    ctx.stroke();
    const val = Math.round(yMax * (1 - i / 4));
    ctx.fillStyle = '#64748b';
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(val.toLocaleString('ru-RU'), pad.left - 8, y + 4);
  }

  const n = options.categories.length;
  const groupW = plotW / Math.max(n, 1);
  const barGap = 4;
  const seriesCount = options.series.length;
  const barW = Math.max(6, (groupW - barGap * 2) / seriesCount - 2);

  options.categories.forEach((cat, i) => {
    const groupX = pad.left + i * groupW + barGap;
    options.series.forEach((s, si) => {
      const v = s.values[i] ?? 0;
      const h = (v / yMax) * plotH;
      const x = groupX + si * (barW + 2);
      const y = pad.top + plotH - h;
      ctx.fillStyle = s.color;
      ctx.fillRect(x, y, barW, h);
    });
    ctx.fillStyle = '#334155';
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.save();
    ctx.translate(groupX + (barW * seriesCount) / 2, pad.top + plotH + 14);
    ctx.rotate(-0.45);
    ctx.fillText(truncateLabel(cat, 22), 0, 0);
    ctx.restore();
  });

  let legendX = pad.left;
  const legendY = height - 28;
  options.series.forEach((s) => {
    ctx.fillStyle = s.color;
    ctx.fillRect(legendX, legendY, 12, 12);
    ctx.fillStyle = '#334155';
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(s.name, legendX + 16, legendY + 11);
    legendX += ctx.measureText(s.name).width + 36;
  });

  return canvas.toDataURL('image/png').split(',')[1] ?? '';
}

function renderPieChartPng(options: {
  title: string;
  slices: Array<{ label: string; value: number; color: string }>;
  width?: number;
  height?: number;
}): string {
  const width = options.width ?? 480;
  const height = options.height ?? 320;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return '';
  }

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#1a3228';
  ctx.font = 'bold 15px system-ui, sans-serif';
  ctx.fillText(options.title, 20, 28);

  const total = options.slices.reduce((s, x) => s + x.value, 0);
  if (total <= 0) {
    ctx.fillStyle = '#94a3b8';
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillText('Нет данных за период', 20, 60);
    return canvas.toDataURL('image/png').split(',')[1] ?? '';
  }

  const cx = 150;
  const cy = height / 2 + 12;
  const r = Math.min(100, height / 2 - 50);
  let start = -Math.PI / 2;

  options.slices.forEach((slice) => {
    const angle = (slice.value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.fillStyle = slice.color;
    ctx.arc(cx, cy, r, start, start + angle);
    ctx.closePath();
    ctx.fill();
    start += angle;
  });

  let ly = 56;
  options.slices.forEach((slice) => {
    ctx.fillStyle = slice.color;
    ctx.fillRect(280, ly, 12, 12);
    ctx.fillStyle = '#334155';
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText(
      `${slice.label}: ${slice.value.toLocaleString('ru-RU')} ₽ (${pct(slice.value, total)}%)`,
      298,
      ly + 11,
    );
    ly += 22;
  });

  return canvas.toDataURL('image/png').split(',')[1] ?? '';
}

function styleHeaderRow(row: ExcelJS.Row) {
  row.height = 22;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: C.headerText }, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.headerBg } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: C.border } },
      left: { style: 'thin', color: { argb: C.border } },
      bottom: { style: 'thin', color: { argb: C.border } },
      right: { style: 'thin', color: { argb: C.border } },
    };
  });
}

function rubFmt(cell: ExcelJS.Cell) {
  cell.numFmt = '#,##0" ₽"';
  cell.alignment = { horizontal: 'right', vertical: 'middle' };
}

export async function downloadFinanceReportXlsx(options: {
  fromDay: string;
  toDay: string;
  rows: FinanceReportExportRow[];
  totals: FinanceReportExportTotals;
  role: string;
}) {
  const { fromDay, toDay, rows, totals, role } = options;
  const periodLabel = fromDay === toDay ? fromDay : `${fromDay} — ${toDay}`;
  const sorted = [...rows].sort((a, b) => b.revenue - a.revenue);
  const topByRevenue = sorted.slice(0, 12);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Фотографы · Sales-platform';
  workbook.created = new Date();

  // ——— Лист: данные ———
  const dataSheet = workbook.addWorksheet('Данные', {
    views: [{ state: 'frozen', ySplit: 3 }],
    properties: { tabColor: { argb: C.green } },
  });

  dataSheet.mergeCells('A1:M1');
  const titleCell = dataSheet.getCell('A1');
  titleCell.value = `Финансовый отчёт · ${periodLabel}`;
  titleCell.font = { bold: true, size: 14, color: { argb: C.titleText } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.titleBg } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'left' };
  dataSheet.getRow(1).height = 28;

  dataSheet.mergeCells('A2:M2');
  dataSheet.getCell('A2').value = role === 'DIRECTOR' ? 'Директор' : 'Бухгалтер';
  dataSheet.getCell('A2').font = { size: 10, color: { argb: C.muted } };
  dataSheet.getRow(2).height = 18;

  const headers = [
    'Магазин',
    'План выручки',
    'Факт выручки',
    'Выполнение плана',
    'Наличные',
    'Эквайринг',
    'Переводы',
    'Отклонение',
    'Затраты на товар',
    'К выплате ЗП',
    'Эквайринг (комиссия)',
    'Прибыль без товара',
    'Прибыль с товаром',
  ];

  dataSheet.addRow(headers);
  styleHeaderRow(dataSheet.getRow(3));

  dataSheet.columns = [
    { width: 28 },
    { width: 14 },
    { width: 14 },
    { width: 14 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 14 },
    { width: 14 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
  ];

  sorted.forEach((row, idx) => {
    const deviation = row.revenue - row.planRevenue;
    const planPct = row.planRevenue > 0 ? row.revenue / row.planRevenue : 0;
    const excelRow = dataSheet.addRow([
      row.storeName,
      roundRub(row.planRevenue),
      roundRub(row.revenue),
      planPct,
      roundRub(row.cashRevenue),
      roundRub(row.nonCashRevenue),
      roundRub(row.transferRevenue),
      roundRub(deviation),
      roundRub(row.goodsSpent),
      roundRub(row.salaries),
      roundRub(row.acquiringFee),
      roundRub(row.profitWithoutGoods),
      roundRub(row.profitWithGoods),
    ]);
    excelRow.height = 20;
    const bg = idx % 2 === 0 ? C.zebraA : C.zebraB;
    excelRow.eachCell((cell, col) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      cell.border = {
        top: { style: 'thin', color: { argb: C.border } },
        left: { style: 'thin', color: { argb: C.border } },
        bottom: { style: 'thin', color: { argb: C.border } },
        right: { style: 'thin', color: { argb: C.border } },
      };
      if (col === 1) {
        cell.font = { size: 10 };
        cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
      } else if (col === 4) {
        cell.numFmt = '0.0%';
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        const v = Number(cell.value) || 0;
        if (v >= 1) {
          cell.font = { color: { argb: C.green }, bold: true };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.greenLight } };
        } else if (v > 0 && v < 1) {
          cell.font = { color: { argb: 'FFB45309' } };
        } else if (v === 0) {
          cell.font = { color: { argb: C.muted } };
        } else {
          cell.font = { color: { argb: C.red }, bold: true };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.redLight } };
        }
      } else if (col === 8) {
        rubFmt(cell);
        const v = Number(cell.value) || 0;
        if (v < 0) {
          cell.font = { color: { argb: C.red }, bold: true };
        } else if (v > 0) {
          cell.font = { color: { argb: C.green } };
        }
      } else if (col > 1) {
        rubFmt(cell);
        cell.font = { size: 10 };
      }
    });
  });

  const totalRow = dataSheet.addRow([
    'ИТОГО',
    roundRub(totals.planRevenue),
    roundRub(totals.revenue),
    totals.planRevenue > 0 ? totals.revenue / totals.planRevenue : 0,
    roundRub(totals.cashRevenue),
    roundRub(totals.nonCashRevenue),
    roundRub(totals.transferRevenue),
    roundRub(totals.revenue - totals.planRevenue),
    roundRub(totals.goodsSpent),
    roundRub(totals.salaries),
    roundRub(totals.acquiringFee),
    roundRub(totals.profitWithoutGoods),
    roundRub(totals.profitWithGoods),
  ]);
  totalRow.height = 24;
  totalRow.eachCell((cell, col) => {
    cell.font = { bold: true, color: { argb: C.totalText }, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.totalBg } };
    cell.border = {
      top: { style: 'medium', color: { argb: C.chartProfit } },
      bottom: { style: 'medium', color: { argb: C.chartProfit } },
    };
    if (col === 4) {
      cell.numFmt = '0.0%';
      cell.alignment = { horizontal: 'center' };
    } else if (col > 1) {
      rubFmt(cell);
    }
  });

  // ——— Лист: сводка ———
  const summarySheet = workbook.addWorksheet('Сводка', {
    properties: { tabColor: { argb: C.chartProfit } },
  });
  summarySheet.getColumn(1).width = 32;
  summarySheet.getColumn(2).width = 18;
  summarySheet.getColumn(3).width = 36;

  summarySheet.mergeCells('A1:C1');
  summarySheet.getCell('A1').value = `Сводка за период ${periodLabel}`;
  summarySheet.getCell('A1').font = { bold: true, size: 13, color: { argb: C.titleText } };
  summarySheet.getRow(1).height = 26;

  const kpiRows: Array<[string, string | number, string?]> = [
    ['Выручка (факт)', roundRub(totals.revenue), '₽'],
    ['План выручки', roundRub(totals.planRevenue), '₽'],
    [
      'Выполнение плана',
      totals.planRevenue > 0 ? totals.revenue / totals.planRevenue : 0,
      '%',
    ],
    ['Отклонение от плана', roundRub(totals.revenue - totals.planRevenue), '₽'],
    ['Наличные', roundRub(totals.cashRevenue), `${pct(totals.cashRevenue, totals.revenue)}% от выручки`],
    ['Эквайринг', roundRub(totals.nonCashRevenue), `${pct(totals.nonCashRevenue, totals.revenue)}%`],
    ['Переводы', roundRub(totals.transferRevenue), `${pct(totals.transferRevenue, totals.revenue)}%`],
    ['Зарплаты к выплате', roundRub(totals.salaries), ''],
    ['Затраты на товар', roundRub(totals.goodsSpent), ''],
    ['Комиссия эквайринга', roundRub(totals.acquiringFee), ''],
    ['Прибыль (без товара)', roundRub(totals.profitWithoutGoods), ''],
    ['Прибыль (с товаром)', roundRub(totals.profitWithGoods), ''],
    ['Точек в отчёте', rows.length, ''],
  ];

  summarySheet.addRow(['Показатель', 'Значение', 'Примечание']);
  styleHeaderRow(summarySheet.getRow(2));

  kpiRows.forEach(([label, value, note], i) => {
    const r = summarySheet.addRow([label, value, note ?? '']);
    r.getCell(1).font = { bold: true, size: 10 };
    if (label === 'Выполнение плана') {
      r.getCell(2).numFmt = '0.0%';
    } else if (typeof value === 'number' && label !== 'Точек в отчёте') {
      rubFmt(r.getCell(2));
    }
    r.getCell(3).font = { size: 9, color: { argb: C.muted } };
    if (i % 2 === 0) {
      r.eachCell((c) => {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.zebraB } };
      });
    }
  });

  const leader = sorted[0];
  const laggard = sorted.length > 0 ? sorted[sorted.length - 1] : null;
  summarySheet.addRow([]);
  summarySheet.addRow(['Лидер по выручке', leader?.storeName ?? '—', leader ? `${roundRub(leader.revenue)} ₽` : '']);
  summarySheet.addRow([
    'Минимальная выручка',
    laggard?.storeName ?? '—',
    laggard ? `${roundRub(laggard.revenue)} ₽` : '',
  ]);
  if (leader && leader.planRevenue > 0) {
    const bestPlan = [...sorted].sort(
      (a, b) => b.revenue / Math.max(b.planRevenue, 1) - a.revenue / Math.max(a.planRevenue, 1),
    )[0];
    summarySheet.addRow([
      'Лучшее выполнение плана',
      bestPlan?.storeName ?? '—',
      bestPlan ? `${pct(bestPlan.revenue, bestPlan.planRevenue)}%` : '',
    ]);
  }

  // ——— Лист: графики (PNG) ———
  const chartSheet = workbook.addWorksheet('Графики', {
    properties: { tabColor: { argb: 'FF4A7C9E' } },
  });
  chartSheet.getColumn(1).width = 3;
  chartSheet.mergeCells('A1:H1');
  chartSheet.getCell('A1').value =
    'Графики по точкам за выбранный период. На листе «Данные» можно построить свои диаграммы Excel (Вставка → Диаграмма).';
  chartSheet.getCell('A1').font = { size: 9, italic: true, color: { argb: C.muted } };
  chartSheet.getRow(1).height = 32;

  const revenuePng = renderGroupedBarChartPng({
    title: 'Выручка по точкам (топ-12)',
    categories: topByRevenue.map((r) => r.storeName),
    series: [{ name: 'Факт выручки', color: '#a67c32', values: topByRevenue.map((r) => roundRub(r.revenue)) }],
  });

  const planFactPng = renderGroupedBarChartPng({
    title: 'План и факт выручки по точкам',
    categories: topByRevenue.map((r) => r.storeName),
    series: [
      { name: 'План', color: '#94a3b8', values: topByRevenue.map((r) => roundRub(r.planRevenue)) },
      { name: 'Факт', color: '#a67c32', values: topByRevenue.map((r) => roundRub(r.revenue)) },
    ],
  });

  const payMixPng = renderPieChartPng({
    title: 'Структура выручки (все точки)',
    slices: [
      { label: 'Наличные', value: roundRub(totals.cashRevenue), color: '#a67c32' },
      { label: 'Эквайринг', value: roundRub(totals.nonCashRevenue), color: '#4a7c9e' },
      { label: 'Переводы', value: roundRub(totals.transferRevenue), color: '#c4a56d' },
    ],
  });

  let chartRow = 2;
  if (revenuePng) {
    const id = workbook.addImage({ base64: revenuePng, extension: 'png' });
    chartSheet.addImage(id, { tl: { col: 0, row: chartRow }, ext: { width: 920, height: 400 } });
    chartRow += 22;
  }
  if (planFactPng) {
    const id = workbook.addImage({ base64: planFactPng, extension: 'png' });
    chartSheet.addImage(id, { tl: { col: 0, row: chartRow }, ext: { width: 920, height: 400 } });
    chartRow += 22;
  }
  if (payMixPng) {
    const id = workbook.addImage({ base64: payMixPng, extension: 'png' });
    chartSheet.addImage(id, { tl: { col: 0, row: chartRow }, ext: { width: 480, height: 300 } });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  downloadBuffer(buffer, `finance-report-${fromDay}_${toDay}.xlsx`);
}

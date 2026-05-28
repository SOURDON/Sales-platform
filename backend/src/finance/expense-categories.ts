/** Статьи расходов в блоке «Оперативка» (согласовано с frontend FINANCE_EXPENSE_CATEGORY_LABELS). */
export const FINANCE_EXPENSE_CATEGORY_LABELS = [
  'Аренда',
  'Налоги',
  'ЗП',
  'Расходка',
  'Ремонт',
  'Техника',
  'Хоз-товары',
  'Попилили',
  'Прочие траты',
] as const;

export type FinanceExpenseCategoryLabel = (typeof FINANCE_EXPENSE_CATEGORY_LABELS)[number];

export function isFinanceExpenseCategoryLabel(value: string): value is FinanceExpenseCategoryLabel {
  return (FINANCE_EXPENSE_CATEGORY_LABELS as readonly string[]).includes(value);
}

export function defaultFinanceCategoryAmounts(): Record<string, number> {
  return Object.fromEntries(FINANCE_EXPENSE_CATEGORY_LABELS.map((title) => [title, 0]));
}

export function normalizeFinanceCategoryAmounts(
  raw: unknown,
): Record<FinanceExpenseCategoryLabel, number> {
  const base = defaultFinanceCategoryAmounts() as Record<FinanceExpenseCategoryLabel, number>;
  if (!raw || typeof raw !== 'object') {
    return base;
  }
  for (const title of FINANCE_EXPENSE_CATEGORY_LABELS) {
    const value = Number((raw as Record<string, unknown>)[title]);
    if (Number.isFinite(value) && value >= 0) {
      base[title] = Math.round(value * 100) / 100;
    }
  }
  return base;
}

export function serializeFinanceCategoryAmounts(
  amounts: Record<string, number>,
): string {
  const payload: Record<string, number> = {};
  for (const title of FINANCE_EXPENSE_CATEGORY_LABELS) {
    const value = amounts[title];
    payload[title] = Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : 0;
  }
  return JSON.stringify(payload);
}

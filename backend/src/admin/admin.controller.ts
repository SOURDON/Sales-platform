import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Put,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import type { Response } from 'express';

interface CreateSaleBody {
  sellerId?: number;
  items?: Array<{
    name: string;
    qty: number;
  }>;
  totalAmount?: number;
  /** CASH = наличные, NON_CASH = безнал / эквайринг, TRANSFER = перевод */
  paymentType?: 'CASH' | 'NON_CASH' | 'TRANSFER';
}

interface SetPercentBody {
  sellerId?: number;
  ratePercent?: number;
}

interface WriteOffBody {
  name?: string;
  qty?: number;
  reason?: 'Брак' | 'Поломка';
}

interface OpenShiftBody {
  assignedSellerIds?: number[];
}

interface CloseShiftBody {
  assignedSellerIds?: number[];
}

interface CashDisciplineBody {
  type?: 'RETURN' | 'CANCEL' | 'ADJUSTMENT';
  comment?: string;
}

interface StaffCreateBody {
  fullName?: string;
  nickname?: string;
}

interface StaffFromBaseBody {
  employeeId?: number;
}

interface RemoveStaffFromStoreBody {
  storeName?: string;
}

interface WriteOffQuery {
  reason?: 'Брак' | 'Поломка';
  dateFrom?: string;
  dateTo?: string;
}

interface CommissionRequestBody {
  sellerId?: number;
  requestedPercent?: number;
  comment?: string;
}

interface ProcurementCostsBody {
  items?: Array<{ name: string; cost: number }>;
}

interface RevenuePlanBody {
  dayKey?: string;
  items?: Array<{ storeName: string; planRevenue: number }>;
}

interface AcquiringPercentBody {
  percent?: number;
}

interface FinanceAccountBalanceBody {
  balance?: number;
}

interface FinanceExpenseBody {
  accountId?: string;
  title?: string;
  amount?: number;
  comment?: string;
}

interface FinanceIncomeBody {
  accountId?: string;
  amount?: number;
  workDay?: string;
  comment?: string;
}

@Controller('admin')
export class AdminController {
  constructor(private readonly authService: AuthService) {}

  @Get('products')
  getProducts(@Headers('authorization') authorization?: string) {
    this.requireFinanceRead(authorization);
    return this.authService.productCatalog;
  }

  @Get('products/procurement-costs')
  getProductProcurementCosts(@Headers('authorization') authorization?: string) {
    this.requireFinanceRead(authorization);
    return this.authService.getProductProcurementCosts();
  }

  @Put('products/procurement-costs')
  setProductProcurementCosts(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: ProcurementCostsBody,
  ) {
    const session = this.requireFinancePlanningAccess(authorization);
    const items = body.items ?? [];
    return this.authService.setProductProcurementCosts(items, session.nickname);
  }

  @Get('revenue-plans')
  getRevenuePlans(
    @Headers('authorization') authorization?: string,
    @Query('dayKey') dayKey?: string,
  ) {
    this.requireFinanceRead(authorization);
    const safeDayKey = dayKey && /^\d{4}-\d{2}-\d{2}$/.test(dayKey)
      ? dayKey
      : new Date().toISOString().slice(0, 10);
    return this.authService.getStoreRevenuePlans(safeDayKey);
  }

  @Put('revenue-plans')
  setRevenuePlans(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: RevenuePlanBody,
  ) {
    const session = this.requireFinancePlanningAccess(authorization);
    const dayKey = body.dayKey && /^\d{4}-\d{2}-\d{2}$/.test(body.dayKey)
      ? body.dayKey
      : new Date().toISOString().slice(0, 10);
    const items = body.items ?? [];
    return this.authService.setStoreRevenuePlans(dayKey, items, session.nickname);
  }

  @Get('acquiring-percent')
  getAcquiringPercent(@Headers('authorization') authorization?: string) {
    this.requireFinanceRead(authorization);
    return {
      percent: this.authService.getAcquiringPercent(),
      detkovPercent: this.authService.getAcquiringPercentDetkov(),
    };
  }

  @Put('acquiring-percent')
  setAcquiringPercent(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: AcquiringPercentBody,
  ) {
    const session = this.requireFinancePlanningAccess(authorization);
    if (body.percent === undefined || !Number.isFinite(body.percent)) {
      throw new BadRequestException('percent is required');
    }
    const result = this.authService.setAcquiringPercent(body.percent, session.nickname);
    if (!result) {
      throw new BadRequestException('percent must be between 0 and 100');
    }
    return result;
  }

  @Put('acquiring-percent/detkov')
  setAcquiringPercentDetkov(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: AcquiringPercentBody,
  ) {
    const session = this.requireFinancePlanningAccess(authorization);
    if (body.percent === undefined || !Number.isFinite(body.percent)) {
      throw new BadRequestException('percent is required');
    }
    const result = this.authService.setAcquiringPercentDetkov(body.percent, session.nickname);
    if (!result) {
      throw new BadRequestException('percent must be between 0 and 100');
    }
    return result;
  }

  @Get('finance/ops')
  getFinanceOps(@Headers('authorization') authorization?: string) {
    this.requireFinanceRead(authorization);
    return this.authService.getFinanceOpsSnapshot() as unknown;
  }

  @Put('finance/accounts/:id/balance')
  setFinanceAccountBalance(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
    @Body() body: FinanceAccountBalanceBody,
  ) {
    const session = this.requireFinanceRead(authorization);
    if (session.role !== 'DIRECTOR') {
      throw new ForbiddenException('Корректировку остатка может выполнить только директор');
    }
    if (body.balance === undefined || !Number.isFinite(body.balance)) {
      throw new BadRequestException('balance is required');
    }
    const account = this.authService.setFinanceAccountBalance(id, body.balance, session.nickname);
    if (!account) {
      throw new BadRequestException('Invalid finance account or balance');
    }
    return account as unknown;
  }

  @Post('finance/expenses')
  addFinanceExpense(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: FinanceExpenseBody,
  ) {
    const session = this.requireFinancePlanningAccess(authorization);
    if (!body.accountId || !body.title || body.amount === undefined || !Number.isFinite(body.amount)) {
      throw new BadRequestException('accountId, title and amount are required');
    }
    const expense = this.authService.addFinanceExpense(
      {
        accountId: body.accountId,
        title: body.title,
        amount: body.amount,
        comment: body.comment,
      },
      session.nickname,
    );
    if (!expense) {
      throw new BadRequestException('Invalid finance expense payload');
    }
    return expense as unknown;
  }

  @Post('finance/incomes')
  addFinanceIncome(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: FinanceIncomeBody,
  ) {
    const session = this.requireFinancePlanningAccess(authorization);
    const workDay =
      body.workDay && /^\d{4}-\d{2}-\d{2}$/.test(body.workDay) ? body.workDay : undefined;
    if (!body.accountId || body.amount === undefined || !Number.isFinite(body.amount) || !workDay) {
      throw new BadRequestException('accountId, amount and workDay (YYYY-MM-DD) are required');
    }
    const income = this.authService.addFinanceIncome(
      {
        accountId: body.accountId,
        amount: body.amount,
        workDay,
        comment: body.comment,
      },
      session.nickname,
    );
    if (!income) {
      throw new BadRequestException('Invalid finance income payload');
    }
    return income as unknown;
  }

  @Get('shifts')
  getShifts(@Headers('authorization') authorization?: string) {
    this.requireFinanceRead(authorization);
    return this.authService.getShifts() as unknown;
  }

  @Post('shifts/open')
  openShift(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: OpenShiftBody,
  ) {
    const session = this.requireShiftOperator(authorization);
    const shift = this.authService.openShift(
      session.nickname,
      body.assignedSellerIds ?? [],
    );
    if (!shift) {
      throw new BadRequestException('Failed to open shift');
    }
    return shift as unknown;
  }

  @Post('shifts/close')
  closeShift(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: CloseShiftBody,
  ) {
    const session = this.requireShiftOperator(authorization);
    const shift = this.authService.closeShift(session.nickname, body.assignedSellerIds ?? []);
    if (!shift) {
      throw new BadRequestException('No open shift');
    }
    return shift as unknown;
  }

  @Get('sellers')
  getSellers(@Headers('authorization') authorization?: string) {
    const session = this.requireFinanceRead(authorization);
    return this.authService.getSellerProfilesForSession(session.nickname);
  }

  @Get('sales')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate')
  async getSales(@Headers('authorization') authorization?: string) {
    const session = this.requireFinanceRead(authorization);
    return this.authService.getSalesSnapshotForSessionEnriched(session.nickname) as unknown;
  }

  @Get('write-offs')
  getWriteOffs(
    @Headers('authorization') authorization?: string,
    @Query() query?: WriteOffQuery,
  ) {
    this.requireFinanceRead(authorization);
    return this.authService.getWriteOffs(query) as unknown;
  }

  @Get('cash-discipline')
  getCashDiscipline(@Headers('authorization') authorization?: string) {
    this.requireFinanceRead(authorization);
    return this.authService.getCashDisciplineEvents() as unknown;
  }

  @Post('cash-discipline')
  addCashDiscipline(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: CashDisciplineBody,
  ) {
    const session = this.requireWriteAccess(authorization);
    if (!body.type || !body.comment) {
      throw new BadRequestException('type and comment are required');
    }
    const event = this.authService.addCashDisciplineEvent(
      body.type,
      body.comment,
      session.nickname,
    );
    if (!event) {
      throw new BadRequestException('Invalid cash discipline event');
    }
    return event as unknown;
  }

  @Get('staff')
  getStaff(@Headers('authorization') authorization?: string) {
    const session = this.requireFinanceRead(authorization);
    return this.authService.getStaffForSession(session.nickname) as unknown;
  }

  @Get('employees/global')
  getGlobalEmployees(@Headers('authorization') authorization?: string) {
    this.requireFinanceRead(authorization);
    return this.authService.getGlobalEmployees() as unknown;
  }

  @Post('staff')
  addStaff(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: StaffCreateBody,
  ) {
    const session = this.requireWriteAccess(authorization);
    if (!body.fullName || !body.nickname) {
      throw new BadRequestException('fullName and nickname are required');
    }
    const staff = this.authService.addStaff(body.fullName, body.nickname, session.nickname);
    if (!staff) {
      throw new BadRequestException('Could not add staff (possibly duplicate nickname)');
    }
    return staff as unknown;
  }

  @Post('staff/from-base')
  addStaffFromBase(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: StaffFromBaseBody,
  ) {
    const session = this.requireWriteAccess(authorization);
    if (!body.employeeId) {
      throw new BadRequestException('employeeId is required');
    }
    const staff = this.authService.addStaffFromGlobal(body.employeeId, session.nickname);
    if (!staff) {
      throw new BadRequestException('Employee not found in global base');
    }
    return staff as unknown;
  }

  @Patch('staff/:id/deactivate')
  deactivateStaff(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
  ) {
    const session = this.requireFinanceRead(authorization);
    const staff = this.authService.deactivateStaff(Number(id), session.nickname);
    if (!staff) {
      throw new BadRequestException('Staff not found');
    }
    return staff as unknown;
  }

  @Patch('staff/:id/activate')
  activateStaff(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
  ) {
    const session = this.requireWriteAccess(authorization);
    const staff = this.authService.activateStaff(Number(id), session.nickname);
    if (!staff) {
      throw new BadRequestException('Staff not found');
    }
    return staff as unknown;
  }

  @Patch('staff/:id/assign-shift')
  assignShift(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
    @Body() body: { shiftId?: string },
  ) {
    const session = this.requireWriteAccess(authorization);
    if (!body.shiftId) {
      throw new BadRequestException('shiftId is required');
    }
    const staff = this.authService.assignStaffToShift(
      Number(id),
      body.shiftId,
      session.nickname,
    );
    if (!staff) {
      throw new BadRequestException('Staff or open shift not found');
    }
    return staff as unknown;
  }

  @Post('staff/:id/remove-from-store')
  removeStaffFromStore(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
    @Body() body: RemoveStaffFromStoreBody,
  ) {
    const session = this.requireRemoveFromStoreAccess(authorization);
    const staff = this.authService.removeStaffFromStore(Number(id), session.nickname, body.storeName);
    if (!staff) {
      throw new BadRequestException('Staff not found in selected store');
    }
    return staff as unknown;
  }

  @Get('notifications/thresholds')
  getThresholds(@Headers('authorization') authorization?: string) {
    this.requireFinanceRead(authorization);
    return this.authService.getThresholdNotifications() as unknown;
  }

  @Get('audit-log')
  getAuditLog(@Headers('authorization') authorization?: string) {
    this.requireFinanceRead(authorization);
    return this.authService.getAuditLog() as unknown;
  }

  @Get('write-offs/export')
  exportWriteOffsCsv(
    @Headers('authorization') authorization: string | undefined,
    @Query() query: WriteOffQuery,
    @Res() response: Response,
  ) {
    this.requireFinanceRead(authorization);
    const csv = this.authService.getWriteOffsCsv(query);
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="write-offs-${Date.now()}.csv"`,
    );
    response.send(csv);
  }

  @Get('commission-requests')
  listCommissionRequests(@Headers('authorization') authorization?: string) {
    const session = this.requireFinanceRead(authorization);
    return this.authService.getCommissionChangeRequestsForSession(session.nickname) as unknown;
  }

  @Post('commission-requests')
  createCommissionRequest(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: CommissionRequestBody,
  ) {
    this.requireWriteAccess(authorization);
    void body;
    throw new ForbiddenException('Процент может редактировать только директор');
  }

  @Put('sellers/percent')
  async setSellerPercent(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: SetPercentBody,
  ) {
    const session = this.requireDirectorOrAccountantAccess(authorization);
    if (!body.sellerId || body.ratePercent === undefined) {
      throw new BadRequestException('sellerId and ratePercent are required');
    }

    const result = await this.authService.setSellerPercentDirect(body.sellerId, body.ratePercent);
    if (!result) {
      throw new BadRequestException('Seller not found or invalid percent');
    }
    return result;
  }

  @Post('sales')
  createSale(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: CreateSaleBody,
  ) {
    const session = this.requireWriteAccess(authorization);
    if (!body.sellerId || !body.items || body.totalAmount === undefined) {
      throw new BadRequestException('sellerId, items and totalAmount are required');
    }
    if (body.totalAmount <= 0) {
      throw new BadRequestException('totalAmount must be greater than zero');
    }

    const paymentType =
      body.paymentType === 'NON_CASH'
        ? 'NON_CASH'
        : body.paymentType === 'TRANSFER'
          ? 'TRANSFER'
          : 'CASH';
    const result = this.authService.addAdminSale(
      body.sellerId,
      body.items,
      body.totalAmount,
      session.nickname,
      paymentType,
    );
    if (!result) {
      throw new BadRequestException(
        'Нельзя оформить продажу: нет открытой смены, неверные позиции, или продавец не в текущей смене. В разделе «Смена» сначала откройте смену и добавьте продавцов.',
      );
    }
    return result as unknown;
  }

  @Post('write-offs')
  createWriteOff(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: WriteOffBody,
  ) {
    const session = this.requireWriteAccess(authorization);
    if (!body.name || !body.qty || !body.reason) {
      throw new BadRequestException('name, qty and reason are required');
    }
    if (body.reason !== 'Брак' && body.reason !== 'Поломка') {
      throw new BadRequestException('reason must be Брак or Поломка');
    }

    const result = this.authService.addWriteOff(
      body.name,
      body.qty,
      body.reason,
      session.nickname,
    );
    if (!result) {
      throw new BadRequestException('Invalid write-off data');
    }
    return result as unknown;
  }

  @Patch('write-offs/:id')
  updateWriteOff(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
    @Body() body: { qty?: number; reason?: 'Брак' | 'Поломка' },
  ) {
    const session = this.requireWriteAccess(authorization);
    if (!body.qty || !body.reason) {
      throw new BadRequestException('qty and reason are required');
    }
    if (body.reason !== 'Брак' && body.reason !== 'Поломка') {
      throw new BadRequestException('reason must be Брак or Поломка');
    }
    const result = this.authService.updateWriteOff(
      id,
      body.qty,
      body.reason,
      session.nickname,
    );
    if (!result) {
      throw new BadRequestException('Write-off not found or invalid qty');
    }
    return result as unknown;
  }

  @Delete('write-offs/:id')
  removeWriteOff(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
  ) {
    const session = this.requireWriteAccess(authorization);
    const ok = this.authService.deleteWriteOff(id, session.nickname);
    if (!ok) {
      throw new BadRequestException('Write-off not found');
    }
    return { ok: true };
  }

  private requireFinanceRead(authorization?: string) {
    const token = authorization?.replace('Bearer ', '').trim();
    if (!token) {
      throw new UnauthorizedException('Missing token');
    }

    const session = this.authService.parseToken(token);
    if (
      !session ||
      (session.role !== 'DIRECTOR' &&
        session.role !== 'ADMIN' &&
        session.role !== 'ACCOUNTANT')
    ) {
      throw new UnauthorizedException('Only director, admin, or accountant allowed');
    }

    return session;
  }

  private requireWriteAccess(authorization?: string) {
    const token = authorization?.replace('Bearer ', '').trim();
    if (!token) {
      throw new UnauthorizedException('Missing token');
    }

    const session = this.authService.parseToken(token);
    if (!session || (session.role !== 'ADMIN' && session.role !== 'DIRECTOR')) {
      throw new UnauthorizedException('Only admin or director allowed');
    }

    return session;
  }

  /** Снятие сотрудника с точки: админ своей точки, директор и бухгалтер (с указанием storeName в теле). */
  private requireRemoveFromStoreAccess(authorization?: string) {
    const token = authorization?.replace('Bearer ', '').trim();
    if (!token) {
      throw new UnauthorizedException('Missing token');
    }
    const session = this.authService.parseToken(token);
    if (
      !session ||
      (session.role !== 'ADMIN' &&
        session.role !== 'DIRECTOR' &&
        session.role !== 'ACCOUNTANT')
    ) {
      throw new UnauthorizedException('Only admin, director, or accountant allowed');
    }
    return session;
  }

  private requireDirectorOrAccountantAccess(authorization?: string) {
    const token = authorization?.replace('Bearer ', '').trim();
    if (!token) {
      throw new UnauthorizedException('Missing token');
    }
    const session = this.authService.parseToken(token);
    if (!session || (session.role !== 'DIRECTOR' && session.role !== 'ACCOUNTANT')) {
      throw new UnauthorizedException('Only director or accountant allowed');
    }
    return session;
  }

  private requireFinancePlanningAccess(authorization?: string) {
    const token = authorization?.replace('Bearer ', '').trim();
    if (!token) {
      throw new UnauthorizedException('Missing token');
    }
    const session = this.authService.parseToken(token);
    if (!session || (session.role !== 'DIRECTOR' && session.role !== 'ACCOUNTANT')) {
      throw new UnauthorizedException('Only director or accountant allowed');
    }
    return session;
  }

  private requireShiftOperator(authorization?: string) {
    const token = authorization?.replace('Bearer ', '').trim();
    if (!token) {
      throw new UnauthorizedException('Missing token');
    }

    const session = this.authService.parseToken(token);
    if (
      !session ||
      (session.role !== 'ADMIN' &&
        session.role !== 'DIRECTOR' &&
        session.role !== 'SELLER')
    ) {
      throw new UnauthorizedException('Only admin, director, or seller allowed');
    }

    return session;
  }
}

import {OwnerAdminController,OwnerCustomerController,OwnerCallbacksController} from './owner-signing/controller';
import {OwnerService} from './owner-signing/owner.service';
import {OwnerIdentityService} from './owner-signing/identity';
import {FadadaOwnerClient} from './owner-signing/fadada-owner.client';
import {fadadaSettings} from './esign/esign.settings';
import {TechnicalAcceptanceController} from './technical-acceptance/controller';
import {TechnicalAcceptanceService} from './technical-acceptance/service';
import {TechnicalAcceptanceSigning} from './technical-acceptance/signing';
import {TechnicalAcceptanceRetention} from './technical-acceptance/retention';
import {SwapPurchasesController} from './swap-purchases/controller';
import {VehicleChangesService} from './vehicle-changes/service';
import {VehicleChangesController} from './vehicle-changes/controller';
import {H5AuthController} from './h5-sign/auth.controller';
import {H5AccountController} from './h5-sign/account.controller';
import {H5RecordsController} from './h5-sign/records.controller';
import {H5RecordsService} from './h5-sign/records.service';
import { DelaySigning } from './order-changes/signing';
import { OrderChangesController } from './order-changes/controller';
import { OrderChangesService } from './order-changes/service';
import 'reflect-metadata';
import { Controller, Get, Inject, Module } from '@nestjs/common';
import { NestFactory, APP_GUARD } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { Db } from './common/db';
import { validateConfig } from './common/config';
import { Errors } from './common/errors';
import { IdentityGateway, PaymentGateway, ESignGateway } from './common/gateways';
import { Access } from './auth/access';
import { AuthController } from './auth/auth.controller';
import { CatalogController } from './catalog/catalog';
import { ApplicationsController } from './applications/applications';
import { CreditReviewController } from './applications/credit-review';
import { UsageController } from './usage/usage.controller';
import { UsageService } from './usage/usage.service';
import { USAGE_CLOCK } from './usage/rules';
import { BillingService, BillingController } from './billing/billing';
import { WorkflowsController } from './operations/workflows';
import { FilesController } from './files/files';
import { CustomerController } from './orders/customer';
import { OrderActionsController } from './orders/order-actions';
import { SignaturesController } from './orders/signatures';
import { SignatureService } from './orders/signature.service';
import { AdminController } from './operations/admin';
import { RealIdentityGateway, identitySettings } from './integrations/identity';
import { WechatPaymentGateway, wechatPaySettings } from './integrations/wechat-payment';
import { createFadadaIntegration } from './esign/esign.module';
import { PaymentCallbacksController } from './integrations/payment-callbacks';
import { createVerificationProvider, VerificationProvider, VERIFICATION_PROVIDER } from './payment-verification/config';
import { PaymentVerificationService } from './payment-verification/service';
import { PaymentVerificationController, VerificationCallbackController } from './payment-verification/controller';
@Controller()
class HealthController {
  constructor(@Inject(Db) private db: Db) {}
  @Get('health') async health() { await this.db.$queryRaw`SELECT 1`; return { status: 'ok', database: 'connected', version: process.env.BUILD_VERSION || '0.1.0' }; }
}
export async function createApp(options: { db?: Db; identity?: IdentityGateway; payment?: PaymentGateway; esign?: ESignGateway; extraControllers?: any[]; extraProviders?: any[]; signatureController?: any; verification?: VerificationProvider; usageClock?:()=>Date } = {}) {
  validateConfig();
  const db = options.db || new Db();
  const fadada = createFadadaIntegration(db);
  const ownerService=new OwnerService(db),ownerConfig=fadadaSettings(),ownerIdentity=new OwnerIdentityService(db,ownerService,ownerConfig,new FadadaOwnerClient(ownerConfig));
  @Module({ controllers: [OwnerAdminController,OwnerCustomerController,OwnerCallbacksController,TechnicalAcceptanceController,SwapPurchasesController,VehicleChangesController,H5AuthController,H5AccountController,H5RecordsController,HealthController, OrderChangesController, AuthController, CatalogController, ApplicationsController, CreditReviewController, UsageController, BillingController, WorkflowsController, FilesController, CustomerController, OrderActionsController, options.signatureController || SignaturesController, PaymentCallbacksController, PaymentVerificationController, VerificationCallbackController, ...fadada.controllers, ...(options.extraControllers || []), AdminController], providers: [{provide:OwnerService,useValue:ownerService},{provide:OwnerIdentityService,useValue:ownerIdentity},{ provide: Db, useValue: db }, { provide: IdentityGateway, useValue: options.identity || new RealIdentityGateway(db, identitySettings()) }, { provide: PaymentGateway, useValue: options.payment || new WechatPaymentGateway(wechatPaySettings()) }, { provide: VERIFICATION_PROVIDER, useValue: options.verification || createVerificationProvider() }, TechnicalAcceptanceService,TechnicalAcceptanceSigning,TechnicalAcceptanceRetention,VehicleChangesService,H5RecordsService, PaymentVerificationService, OrderChangesService, DelaySigning, UsageService, {provide:USAGE_CLOCK,useValue:options.usageClock||(()=>new Date())}, { provide: ESignGateway, useValue: options.esign || fadada.gateway }, BillingService, SignatureService, ...fadada.providers, { provide: APP_GUARD, useClass: Access }, ...(options.extraProviders || [])] })
  class ApiModule {}
  const app = await NestFactory.create(ApiModule, { logger: process.env.NODE_ENV === 'test' ? false : ['error','warn','log'], rawBody: true });
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.enableCors({ origin: (process.env.ADMIN_ORIGIN || 'http://localhost:3100').split(','), credentials: true, allowedHeaders: ['Content-Type','Authorization','X-CSRF-Token'] });
  app.useGlobalFilters(new Errors());
  app.enableShutdownHooks();
  return app;
}

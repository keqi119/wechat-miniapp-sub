import { Db } from '../common/db';
import { ContractPdfArtifactWriterService } from '../contract/contract-pdf-artifact-writer.service';
import { FadadaApiClient } from './fadada/fadada-api.client';
import { FadadaHttpClient } from './fadada/fadada-http-client';
import { FadadaESignGateway } from './fadada/fadada-esign.provider';
import { CustomerESignOnboardingService } from './customer-esign-onboarding.service';
import { SignaturePolicyService } from './enterprise-seal/signature-policy.service';
import { fadadaSettings, FadadaSettings } from './esign.settings';
import { EnterpriseSealController, ESignApprovalController, ESignCustomerController, ESignPublicController, ESIGN_SETTINGS, FadadaCallbacksController } from './esign.controller';
export function createFadadaIntegration(db:Db,settings:FadadaSettings=fadadaSettings()){
  const client=new FadadaApiClient(settings,new FadadaHttpClient(settings));
  const writer=new ContractPdfArtifactWriterService(db);
  const accounts=new CustomerESignOnboardingService(db,settings,client);
  const policies=new SignaturePolicyService(db,writer,accounts,settings);
  const gateway=new FadadaESignGateway(db,settings,client,writer,policies);
  return {gateway,controllers:[ESignCustomerController,EnterpriseSealController,ESignApprovalController,FadadaCallbacksController,ESignPublicController],providers:[{provide:ESIGN_SETTINGS,useValue:settings},{provide:ContractPdfArtifactWriterService,useValue:writer},{provide:CustomerESignOnboardingService,useValue:accounts},{provide:SignaturePolicyService,useValue:policies},{provide:FadadaESignGateway,useValue:gateway}]};
}

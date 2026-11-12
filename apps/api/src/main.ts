import { createApp } from './app';
import { InsuranceRenewalScheduler } from './insurance/renewal-scheduler';
import { BillAutoPublicationScheduler } from './billing/auto-publication-scheduler';
createApp({extraProviders:[InsuranceRenewalScheduler,BillAutoPublicationScheduler]}).then(async app => {
 await app.listen(Number(process.env.PORT || 3101), process.env.HOST || '127.0.0.1');
 app.get(InsuranceRenewalScheduler).start();
 app.get(BillAutoPublicationScheduler).start();
}).catch(() => { console.error('API启动失败，请检查独立数据库和服务配置。'); process.exitCode = 1; });

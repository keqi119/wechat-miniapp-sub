import test from 'node:test';
import {runRenewalStageSwap} from './v31-renewal-stage-swap-journey';
test('actual01 to active05 to manual03 isolates money, rights, calendar and current head',{skip:process.env.NODE_ENV!=='test'},ctx=>runRenewalStageSwap(ctx));

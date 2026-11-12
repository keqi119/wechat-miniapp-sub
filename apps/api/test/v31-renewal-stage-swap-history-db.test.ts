import test from 'node:test';
import {runRenewalStageSwap} from './v31-renewal-stage-swap-journey';
test('actual old05 obligations and allocations survive a later05 stage swap',{skip:process.env.NODE_ENV!=='test'},ctx=>runRenewalStageSwap(ctx,true));

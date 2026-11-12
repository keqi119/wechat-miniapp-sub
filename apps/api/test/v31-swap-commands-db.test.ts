import test from 'node:test';
import {runSwapCommandJourney} from './v31-swap-command-journey';
test('authorized electronic swap source, delayed paid-credit delivery and corrections',{skip:process.env.NODE_ENV!=='test'},ctx=>runSwapCommandJourney(ctx,'delay'));

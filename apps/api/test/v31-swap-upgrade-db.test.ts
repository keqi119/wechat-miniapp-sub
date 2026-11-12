import test from 'node:test';
import {runSwapCommandJourney} from './v31-swap-command-journey';
test('actual electronic swap upgrade finance and metering',{skip:process.env.NODE_ENV!=='test'},ctx=>runSwapCommandJourney(ctx,'upgrade'));

import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePartyVerificationNote} from './contract-party-verification.ts';
for(const [name,input]of [['two characters','同意'],['three characters','已核对'],['501 characters','核'.repeat(501)],['empty',''],['whitespace only',' \t\n '],['trimmed short',' 同意 ']] as const)test('party verification note rejects '+name,()=>{assert.throws(()=>validatePartyVerificationNote(input),/核对资料及说明须填写4～500字/);});
for(const [name,input,expected]of [['four characters','原件核对','原件核对'],['500 characters','核'.repeat(500),'核'.repeat(500)],['trimmed boundary','  \n原件核对\t  ','原件核对']] as const)test('party verification note accepts '+name,()=>{assert.equal(validatePartyVerificationNote(input),expected);});

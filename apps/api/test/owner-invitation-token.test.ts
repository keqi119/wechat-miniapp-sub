import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ownerInvitationToken} from '../src/owner-h5/legal-representative';

test('enterprise invitations accept exactly new 24-character or historical 43-character base64url codes',()=>{
 for(const length of [24,43])assert.equal(ownerInvitationToken.parse('Ab0_-'.repeat(9).slice(0,length)).length,length);
});

test('enterprise invitations reject intermediate lengths whitespace and non-base64url characters',()=>{
 const invalid=[...[0,1,18,23,25,32,42,44,64].map(length=>'A'.repeat(length)),
  'A'.repeat(23)+'+','A'.repeat(23)+'/','A'.repeat(23)+'=','A'.repeat(23)+'中',
  'A'.repeat(23)+' ','A'.repeat(24)+'\n','A'.repeat(43)+'\n',' '+ 'A'.repeat(24),
  'A'.repeat(24)+'\r\n','a'.repeat(23)+'\n','A'.repeat(23)+'\u200b'];
 for(const value of invalid)assert.equal(ownerInvitationToken.safeParse(value).success,false,JSON.stringify(value));
});

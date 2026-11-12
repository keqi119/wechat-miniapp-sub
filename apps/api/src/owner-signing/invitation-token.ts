import {randomBytes} from 'node:crypto';
import {z} from 'zod';

// Keep historical 32-byte invitations redeemable; new invitations use 144 bits.
export const ownerInvitationToken=z.string().refine(
 value=>(value.length===24||value.length===43)&&! /[^A-Za-z0-9_-]/.test(value),
 {message:'邀请码须为 24 位或历史 43 位字母、数字、下划线或短横线'}
);
export function createOwnerInvitationToken(){return randomBytes(18).toString('base64url');}

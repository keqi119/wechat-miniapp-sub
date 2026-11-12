import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Db} from '../src/common/db';
import {AuthController} from '../src/auth/auth.controller';
import {passwordHash,passwordMatches} from '../src/auth/auth.service';
import {staffCreateInput,staffResetInput} from '../src/auth/staff.types';

test('staff create and reset accept 8–256 characters with exact password bytes',()=>{
 const create={username:'synthetic-policy',name:'合成员工',role:'FIELD',idempotencyKey:randomUUID()};
 const reset={revision:0,reason:'合成密码长度核验',idempotencyKey:randomUUID()};
 for(const length of [8,15,256]){
  const password=' '+'Q'.repeat(length-2)+' ';
  assert.equal(staffCreateInput.parse({...create,password}).password,password);
  assert.equal(staffResetInput.parse({...reset,newPassword:password}).newPassword,password);
 }
 for(const length of [7,257]){
  assert.equal(staffCreateInput.safeParse({...create,password:'Q'.repeat(length)}).success,false);
  assert.equal(staffResetInput.safeParse({...reset,newPassword:'Q'.repeat(length)}).success,false);
 }
});
test('self-service password changes enforce 8–256 before touching account state',async()=>{
 const controller=new AuthController({serial:()=>{throw new Error('Invalid password must not touch database');}} as any,{} as any);
 for(const length of [7,257])await assert.rejects(controller.changePassword({currentPassword:'synthetic-old',newPassword:'Q'.repeat(length)},{admin:{id:'synthetic'}},{}),e=>(e as any)?.issues?.some((issue:any)=>issue.path.includes('newPassword')));
});
test('8 and 256 character replacements authenticate and revoke every previous session',async()=>{
 const db=new Db();try{
  const controller=new AuthController(db,{} as any);
  for(const length of [8,256]){
   const currentPassword='synthetic-original-password',newPassword=' '+'Q'.repeat(length-2)+' ';
   const user=await db.adminUser.create({data:{username:randomUUID(),name:'合成密码验收',role:'ADMIN',passwordHash:passwordHash(currentPassword)}});
   await db.adminSession.createMany({data:[1,2].map(()=>({id:randomUUID(),adminId:user.id,authVersion:user.authVersion,csrfToken:randomUUID(),expiresAt:new Date(Date.now()+60000)}))});
   let cleared=false;
   const result=await controller.changePassword({currentPassword,newPassword},{admin:user},{clearCookie:()=>{cleared=true;}});
   assert.deepEqual(result,{success:true,loginRequired:true});assert.equal(cleared,true);
   const updated=await db.adminUser.findUniqueOrThrow({where:{id:user.id}});
   assert.equal(updated.authVersion,user.authVersion+1);assert.equal(await db.adminSession.count({where:{adminId:user.id}}),0);
   assert.equal(passwordMatches(newPassword,updated.passwordHash),true);assert.equal(passwordMatches(currentPassword,updated.passwordHash),false);
   const login=await controller.adminLogin({username:user.username,password:newPassword},{ip:'127.0.0.1'},{cookie:()=>{}});assert.equal(login.user.id,user.id);
  }
 }finally{await db.$disconnect();}
});

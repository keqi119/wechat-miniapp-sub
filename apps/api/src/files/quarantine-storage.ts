import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {promises as fs} from 'node:fs';
import {resolve,sep} from 'node:path';
import {ensure} from '../common/errors';
const run=promisify(execFile);
const windowsProtection=`$ErrorActionPreference='Stop'
$p=$env:NINDA_PRIVATE_PATH
$directory=[IO.Directory]::Exists($p)
if($directory){$item=[IO.DirectoryInfo]::new($p)}else{$item=[IO.FileInfo]::new($p)}
if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Private path cannot be a reparse point'}
$service=[Security.Principal.WindowsIdentity]::GetCurrent().User
$ids=@($service.Value)+@(ConvertFrom-Json -InputObject $env:NINDA_PRIVATE_RECOVERY_SIDS)
$ids=@($ids|Where-Object {$_}|Select-Object -Unique)
if($directory){$acl=New-Object Security.AccessControl.DirectorySecurity}else{$acl=New-Object Security.AccessControl.FileSecurity}
$acl.SetOwner($service)
$acl.SetAccessRuleProtection($true,$false)
foreach($id in $ids){
 $sid=[Security.Principal.SecurityIdentifier]::new([string]$id)
 if($directory){$rule=[Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')}else{$rule=[Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','Allow')}
 $acl.AddAccessRule($rule)
}
if($directory){[IO.Directory]::SetAccessControl($p,$acl);$actual=[IO.Directory]::GetAccessControl($p)}else{[IO.File]::SetAccessControl($p,$acl);$actual=[IO.File]::GetAccessControl($p)}
if(!$actual.AreAccessRulesProtected -or $actual.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $service.Value){throw 'Private owner/inheritance verification failed'}
$rules=@($actual.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
if($rules.Count -ne $ids.Count){throw 'Unexpected private ACL entries'}
foreach($r in $rules){if($r.IsInherited -or $r.AccessControlType -ne 'Allow' -or $ids -notcontains $r.IdentityReference.Value -or $r.FileSystemRights -ne 'FullControl'){throw 'Unexpected private ACL rights'}}
`;
/** No shell interpolation; paths/SIDs travel only in child environment. */
export async function validateQuarantinePath(path:string,uploadRoot:string){
 const root=resolve(uploadRoot),target=resolve(path);ensure(target===root||target.startsWith(root+sep),409,'QUARANTINE_PATH_INVALID','隔离文件路径超出受控目录');
 const rootInfo=await fs.lstat(root),info=await fs.lstat(target);ensure(!rootInfo.isSymbolicLink()&&!info.isSymbolicLink(),409,'QUARANTINE_PATH_INVALID','隔离路径不能是链接');
 // Validate every existing intermediate component, including a legacy shard.
 let current=target;while(current!==root){ensure(!(await fs.lstat(current)).isSymbolicLink(),409,'QUARANTINE_PATH_INVALID','隔离路径不能经过链接');current=resolve(current,'..');}
 return{target,info};
}
export async function protectQuarantinePath(path:string,uploadRoot:string){
 const {target,info}=await validateQuarantinePath(path,uploadRoot);
 if(process.platform==='win32'){
  const recovery=JSON.parse(process.env.ELECTRONIC_QUARANTINE_RECOVERY_SIDS||'[]');ensure(Array.isArray(recovery)&&recovery.length<=16&&recovery.every(v=>typeof v==='string'&&/^S-1-(?:\d+-)*\d+$/.test(v)),503,'QUARANTINE_ACL_CONFIG','恢复管理员SID配置无效');
  await run('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(windowsProtection,'utf16le').toString('base64')],{windowsHide:true,timeout:20000,maxBuffer:4096,env:{...process.env,NINDA_PRIVATE_PATH:target,NINDA_PRIVATE_RECOVERY_SIDS:JSON.stringify(recovery)}});
 }else{const mode=info.isDirectory()?0o700:0o600,uid=process.getuid!();if(info.uid!==uid)await fs.chown(target,uid,process.getgid!());await fs.chmod(target,mode);const actual=await fs.stat(target);ensure(actual.uid===uid&&(actual.mode&0o777)===mode,503,'QUARANTINE_PERMISSIONS','隔离文件权限未生效');}
}

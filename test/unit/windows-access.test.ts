import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { initializeRoot } from '../../src/store/files.js';

test('Windows 异步权限初始化可重复执行，受限 ACL 保持；工具失败时不创建业务子目录', { skip: process.platform !== 'win32' }, async () => {
  const parent = resolve('output/playwright/tests'); await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, 'windows-acl-'));
  await initializeRoot(root); await initializeRoot(root);
  const ps = join(process.env.SystemRoot ?? 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const { stdout } = await promisify(execFile)(ps, ['-NoProfile', '-Command',
    '$ErrorActionPreference="Stop"; $acl=[IO.Directory]::GetAccessControl($env:TENDER_TEST_ACL_ROOT); $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value; $rules=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])); @{protected=$acl.AreAccessRulesProtected; current=@($rules|Where-Object {$_.IdentityReference.Value -eq $sid -and $_.AccessControlType -eq "Allow"}).Count; system=@($rules|Where-Object {$_.IdentityReference.Value -eq "S-1-5-18"}).Count; inherited=@($rules|Where-Object {$_.IsInherited}).Count}|ConvertTo-Json -Compress'],
    { env: { ...process.env, TENDER_TEST_ACL_ROOT: root }, windowsHide: true });
  const acl = JSON.parse(stdout); assert.equal(acl.protected, true); assert.equal(acl.inherited, 0); assert.ok(acl.current > 0); assert.ok(acl.system > 0);
  const failed = join(root, 'failed'); const previousPath = process.env.PATH;
  try {
    process.env.PATH = '';
    await assert.rejects(initializeRoot(failed), /WINDOWS_ACL_FAILED.*whoami.*ENOENT/);
  } finally { if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath; }
  await assert.rejects(access(join(failed, 'objects')));
});

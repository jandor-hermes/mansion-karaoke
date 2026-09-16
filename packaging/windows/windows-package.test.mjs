import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const readSource = (relativePath) => {
  const absolutePath = path.join(root, relativePath);
  return existsSync(absolutePath) ? readFileSync(absolutePath, 'utf8') : '';
};

const sourceBetween = (source, start, end) => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing source marker: ${start}`);
  assert.notEqual(endIndex, -1, `missing source marker: ${end}`);
  return source.slice(startIndex, endIndex);
};

const launcher = readSource('packaging/windows/Launcher.cpp');
const buildScript = readSource('packaging/windows/build-app.ps1');
const runtimeTests = readSource('packaging/windows/app-bundle.test.ps1');
const workflow = readSource('.github/workflows/windows-app.yml');

const requiredImplementationFiles = [
  'packaging/windows/Launcher.cpp',
  'packaging/windows/app.manifest',
  'packaging/windows/resources.rc',
  'packaging/windows/build-app.ps1',
  'packaging/windows/app-bundle.test.ps1',
  '.github/workflows/windows-app.yml',
  'FRIEND_SETUP_WINDOWS.md',
  'NOTICE.md',
];

test('Windows package provides native launcher, build, runtime-test, workflow, and release inputs', () => {
  const missing = requiredImplementationFiles.filter((relativePath) => !existsSync(path.join(root, relativePath)));
  assert.deepEqual(missing, [], `missing Windows package inputs:\n${missing.join('\n')}`);
});

test('launcher generates eight-character party tokens with Windows cryptography', () => {
  assert.match(launcher, /BCryptGenRandom/);
  assert.match(launcher, /ABCDEFGHJKLMNPQRSTUVWXYZ23456789/);
  assert.match(launcher, /\b8\b/);
  assert.match(launcher, /BCRYPT_USE_SYSTEM_PREFERRED_RNG/);
});

test('launcher keeps mutable state in LOCALAPPDATA and copies a versioned extension there', () => {
  assert.match(launcher, /FOLDERID_LocalAppData|LOCALAPPDATA/);
  assert.match(launcher, /Mansion Karaoke/);
  assert.match(launcher, /party-token/);
  assert.match(launcher, /controller\.log/);
  assert.match(launcher, /firefox-extension/);
  assert.match(launcher, /manifest\.json/);
  assert.match(launcher, /CopyFileW|copy_file/);
});

test('launcher passes the Firefox internal page directly to the Firefox process', () => {
  assert.match(launcher, /CreateProcessW/);
  assert.match(launcher, /about:debugging#\/runtime\/this-firefox/);
  assert.doesNotMatch(launcher, /ShellExecute(?:Ex)?W?[\s\S]{0,500}about:debugging#\/runtime\/this-firefox/);
});

test('launcher owns controller lifetime with a kill-on-close Job Object', () => {
  assert.match(launcher, /CreateJobObjectW/);
  assert.match(launcher, /JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE/);
  assert.match(launcher, /AssignProcessToJobObject/);
});

test('controller launch inherits only explicit log and safe NUL standard handles', () => {
  const startController = sourceBetween(launcher, 'void StartController', 'bool ControllerReady');
  assert.match(startController, /STARTUPINFOEXW/);
  assert.match(launcher, /InitializeProcThreadAttributeList/);
  assert.match(launcher, /PROC_THREAD_ATTRIBUTE_HANDLE_LIST/);
  assert.match(launcher, /UpdateProcThreadAttribute/);
  assert.match(startController, /EXTENDED_STARTUPINFO_PRESENT/);
  assert.match(launcher, /DeleteProcThreadAttributeList/);
  assert.match(startController, /CreateFileW\([^;]*L"NUL"[^;]*GENERIC_READ/s);
  assert.match(startController, /std::array<HANDLE, 2>[\s\S]*nullInput\.get\(\)[\s\S]*inheritableLog\.get\(\)/);
  assert.doesNotMatch(startController, /hStdInput\s*=\s*app\.log\.get\(\)/);
});

test('self-test report never serializes the live party token', () => {
  const selfTest = sourceBetween(launcher, 'int RunSelfTest', 'int RunGui');
  assert.match(selfTest, /\\"token\\"/);
  assert.match(selfTest, /\\"path\\"/);
  assert.match(selfTest, /\\"valid\\"/);
  assert.match(selfTest, /\\"disposition\\"/);
  assert.doesNotMatch(selfTest, /\\"value\\"/);
  assert.doesNotMatch(selfTest, /WideToUtf8\(token\.value\)/);
});

test('host-smoke mode uses production startup, authenticated readiness, and Job cleanup', () => {
  assert.match(launcher, /--host-smoke-json/);
  const hostSmoke = sourceBetween(launcher, 'void WriteHostSmokeReport', 'int RunGui');
  assert.match(hostSmoke, /ResolvePaths\(\)/);
  assert.match(hostSmoke, /EnsureStateDirectory/);
  assert.match(hostSmoke, /LoadOrCreateToken/);
  assert.match(hostSmoke, /InstallExtension/);
  assert.match(hostSmoke, /ProbeControllerPort/);
  assert.match(hostSmoke, /StartController\(g_app\)/);
  assert.match(hostSmoke, /ControllerReady\(g_app\.partyToken\)/);
  assert.match(hostSmoke, /StopController\(\)/);
  assert.match(hostSmoke, /GetProcessId/);
  assert.match(hostSmoke, /\\"authenticated\\"/);
  assert.match(hostSmoke, /\\"statusCode\\"/);
  assert.match(hostSmoke, /\\"roomId\\"/);
  assert.match(hostSmoke, /\\"classification\\"/);
  assert.match(hostSmoke, /\\"message\\"/);
  assert.doesNotMatch(hostSmoke, /WideToUtf8\(g_app\.partyToken\)|\\"token\\"/);
});

test('Firefox registry roots are runtime constants and search both registry views', () => {
  const findFirefox = sourceBetween(launcher, 'std::optional<fs::path> FindFirefox', 'void CopyTokenToClipboard');
  assert.match(findFirefox, /const std::array<std::pair<HKEY/);
  assert.doesNotMatch(findFirefox, /constexpr std::array<std::pair<HKEY/);
  assert.match(findFirefox, /RRF_SUBKEY_WOW6432KEY/);
  assert.match(findFirefox, /RRF_SUBKEY_WOW6464KEY/);
  assert.match(findFirefox, /LocalAppDataPath\(\)[\s\S]*Mozilla Firefox[\s\S]*firefox\.exe/);
});

test('launcher keeps supervising the controller after readiness', () => {
  const readiness = sourceBetween(launcher, 'void CheckReadiness', 'LRESULT CALLBACK WindowProcedure');
  assert.match(launcher, /bool controllerReady\s*=\s*false/);
  assert.match(readiness, /WaitForSingleObject[\s\S]*ControllerReady/);
  assert.match(readiness, /controllerReady\s*=\s*true/);
  assert.doesNotMatch(readiness, /ControllerReady[\s\S]{0,300}KillTimer/);
  assert.match(readiness, /Controller stopped[\s\S]*exit/);
});

test('readiness follows KARAOKE_BIND and preflight errors are classified', () => {
  const probe = sourceBetween(launcher, 'PortResult ProbeControllerPort', 'std::string LowerAscii');
  const readiness = sourceBetween(launcher, 'bool ControllerReady', 'void SetStatus');
  const probeMessage = sourceBetween(launcher, 'std::wstring PortProbeMessage', 'void StopController');
  const runGui = sourceBetween(launcher, 'int RunGui', '} // namespace');
  assert.match(launcher, /ReadinessHost/);
  assert.match(launcher, /0\.0\.0\.0[\s\S]*127\.0\.0\.1/);
  assert.match(launcher, /L"::"[\s\S]*L"::1"/);
  assert.match(readiness, /WinHttpConnect\(session\.get\(\),\s*host\.c_str\(\)/);
  assert.match(probe, /WSAEADDRINUSE/);
  assert.match(runGui, /port\.error\s*==\s*WSAEADDRINUSE/);
  assert.match(runGui, /PortProbeMessage/);
  assert.match(probeMessage, /configuration/i);
  assert.match(probeMessage, /socket/i);
});

test('single-instance mutex is cross-session and current-user-only', () => {
  const mutexName = sourceBetween(launcher, 'std::wstring CurrentUserMutexName', 'bool HasArgument');
  const mutexCreation = sourceBetween(launcher, 'UniqueHandle CreateCurrentUserMutex', 'bool HasArgument');
  const runGui = sourceBetween(launcher, 'int RunGui', '} // namespace');
  assert.match(mutexName, /Global\\\\MansionKaraokeHost-/);
  assert.doesNotMatch(mutexName, /Local\\\\MansionKaraokeHost-/);
  assert.match(mutexCreation, /SECURITY_ATTRIBUTES/);
  assert.match(mutexCreation, /SetSecurityDescriptorDacl/);
  assert.match(mutexCreation, /CreateMutexW\(&[^,]+,\s*FALSE/);
  assert.match(runGui, /CreateCurrentUserMutex/);
});

test('launcher polls authenticated status and diagnoses both port-conflict paths', () => {
  assert.match(launcher, /WinHttpOpen|WinHttpSendRequest/);
  assert.match(launcher, /\/status/);
  assert.match(launcher, /Authorization: Bearer/);
  assert.doesNotMatch(launcher, /Authorization: \*\*\*/);
  assert.match(launcher, /200/);
  assert.match(launcher, /WSAEADDRINUSE/);
  assert.match(launcher, /address already in use|port[^\r\n]{0,80}in use/i);
});

test('build script creates the self-contained x64 package contract', () => {
  assert.match(buildScript, /bun-windows-x64/);
  assert.match(buildScript, /--windows-hide-console/);
  assert.match(buildScript, /compiled-server\.ts/);
  assert.match(buildScript, /\/std:c\+\+20/i);
  assert.match(buildScript, /\/MT\b/);
  assert.match(buildScript, /\/W4\b/);
  assert.match(buildScript, /\/WX\b/);
  assert.match(buildScript, /\/SUBSYSTEM:WINDOWS/i);
  assert.match(buildScript, /Mansion Karaoke\.exe/);
  assert.match(buildScript, /resources[\\/]mansion-controller\.exe/);
  assert.match(buildScript, /resources[\\/]firefox-extension/);
  assert.match(buildScript, /FRIEND_SETUP_WINDOWS\.md/);
  assert.match(buildScript, /LICENSE/);
  assert.match(buildScript, /NOTICE\.md/);
  assert.match(buildScript, /Mansion-Karaoke-.+-Windows-x64\.zip/);
  assert.match(buildScript, /SHA256|SHA-256/i);
});

test('Windows runtime tests execute packaged binaries and enforce exact PE x64 headers', () => {
  assert.match(runtimeTests, /0x5A4D/i);
  assert.match(runtimeTests, /0x00004550/i);
  assert.match(runtimeTests, /0x8664/i);
  assert.match(runtimeTests, /Mansion Karaoke\.exe/);
  assert.match(runtimeTests, /mansion-controller\.exe/);
  assert.match(runtimeTests, /--self-test-json/);
  assert.match(runtimeTests, /\/status/);
  assert.match(runtimeTests, /401/);
  assert.match(runtimeTests, /VCRUNTIME|MSVCP/);
});

test('Windows workflow performs the focused contract, native build, runtime smoke, and artifact gates', () => {
  assert.match(workflow, /runs-on:\s*windows-latest/);
  assert.match(workflow, /bun-version:\s*['"]?1\.3\.13/);
  assert.match(workflow, /bun install[^\r\n]*\r?\n[\s\S]*bun install --cwd players[\\/]firefox-extension/);
  assert.match(workflow, /bun install --no-save/);
  assert.doesNotMatch(workflow, /bun install --frozen-lockfile/);
  assert.match(workflow, /node --test packaging[\\/]windows[\\/]windows-package\.test\.mjs/);
  assert.match(workflow, /build-app\.ps1/);
  assert.match(workflow, /app-bundle\.test\.ps1/);
  assert.match(workflow, /upload-artifact/);
  assert.match(workflow, /\.zip/);
  assert.match(workflow, /\.sha256/);
});

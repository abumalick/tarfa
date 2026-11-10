import { randomBytes } from 'node:crypto';
import { homedir, hostname, userInfo } from 'node:os';
import { readFile, mkdir, realpath } from 'node:fs/promises';
import { dirname, join as joinPath, resolve as resolvePath } from 'node:path';
import { installKind, isEntrypoint, packageRoot, packageVersion, type InstallKind } from './infrastructure/package-root';
import { loadConfig, withLegacyEnv, type AgentConfig } from './infrastructure/config';
import { migrateStateDir, stateDirLayout } from './infrastructure/state-dir';
import { systemClock, systemPathResolver } from './infrastructure/system';
import { ShortWorkspaceIds } from './application/short-workspace-ids';
import { WAIT_POLL_MS, WAIT_SETTLE_MS, WaitTracker } from './application/wait-tracker';
import { renameWorkspace } from './application/rename-workspace';
import { TmuxAdapter } from './infrastructure/tmux-adapter';
import { FsProjectLister } from './infrastructure/fs-project-lister';
import { FileRecentStore } from './infrastructure/file-recent-store';
import { FileHiddenFoldersStore } from './infrastructure/file-hidden-folders-store';
import { GitRepoRemote } from './infrastructure/git-repo-remote';
import { FileClaudeSessionsStore } from './infrastructure/file-claude-sessions-store';
import { fsIsDirectory } from './infrastructure/fs-directory-checker';
import { createWorkspace } from './application/create-workspace';
import { listWorkspaces } from './application/list-workspaces';
import { getRecentPaths } from './application/get-recent-paths';
import { browseDir } from './application/browse-dir';
import { isHiddenPath } from './application/is-hidden-path';
import { hooksFiles } from './infrastructure/hooks-files';
import { parseSetupFlags, planSetup, type PortOwner, type SetupState } from './application/setup-machine';
import { runSetup } from './application/run-setup';
import { runApply } from './application/apply-agent';
import { runUpdate, type UpdateEffects } from './application/update-agent';
import { findMise, miseCli } from './infrastructure/mise-cli';
import { npmRegistry } from './infrastructure/npm-registry';
import { cloneOfUnit, renderService, unitRunsLauncher } from './application/service-unit';
import { planCli, type CliState } from './application/cli-wrapper';
import { copyEnvOnce, firstOnPath, linkKind, linkPerch, readCliEntry, removeLink } from './infrastructure/cli-files';
import { atomicWrite } from './infrastructure/atomic-write';
import { agentLog, type AgentLog } from './infrastructure/agent-log';
import { serviceInstall } from './infrastructure/service-install';
import { tailscaleCli } from './infrastructure/tailscale-cli';
import { portOwner } from './infrastructure/port-owner';
import { answersUpgrade } from './infrastructure/listener-check';
import type { ServiceInstallPort } from './ports/service-install-port';
import type { TailscalePort } from './ports/tailscale-port';
import type { AgentServicePort } from './ports/agent-service-port';
import { loadOrCreateAgentKeys } from './infrastructure/agent-key-file';
import { FileDeviceStore } from './infrastructure/file-device-store';
import { FileDictationKeysStore } from './infrastructure/file-dictation-keys-store';
import { readSecret } from './infrastructure/read-secret';
import { changeDictationKey, DICTATION_PROVIDERS, providerOf } from './application/dictation-keys';
import { enrolmentMode, forgetDevice, revokeDevice, withEnrolmentMode, type Device, type DeviceRoster, type EnrolmentMode } from './application/device-roster';
import encodeQR from 'qr';
import { deviceFingerprint, generatePairingSecret, isMachineUrl, MAX_ADDRESSES, pairingCode, pairingLink, sanitizeDeviceName, type PairingLink } from '@tarfa/secure-channel';
import { parseEnvFile } from './application/agent-env';
import { mintPairing, pairingName } from './application/pairing-link';
import { PAIRING_TTL_MS } from './application/pairing';
import { FilePairingStore } from './infrastructure/file-pairing-store';
import { agentEnvFile, locateAgentEnv, mainCheckout } from './infrastructure/agent-env-file';
import { agentService } from './infrastructure/agent-service';
import { FileStatusStore } from './infrastructure/file-status-store';
import { FileParkedStore } from './infrastructure/file-parked-store';
import { FsFileWriter } from './infrastructure/fs-file-writer';
import { fsResolveDirectory } from './infrastructure/fs-directory-checker';
import { spawnWorkspace } from './application/spawn-workspace';
import { sessionOfCodexThread, type AgentCli } from './application/agent-message';
import { loginShellResolver } from './infrastructure/installed-detector';
import type { CodexSpawnPort } from './ports/codex-spawn-port';
import { CodexAppServer } from './infrastructure/codex-app-server';
import { codexVersions, loginShell } from './infrastructure/codex-versions';
import { resolveCodexHome } from './infrastructure/codex-home';
import { formatWorkspaceTable } from './application/format-workspace-table';
import { isUnderPath, WORKSPACE_ROLES, workspaceRole, type WorkspaceRole } from './application/workspace-role';
import type { TmuxPort } from './ports/tmux-port';
import type { StatusStorePort } from './ports/status-store-port';

function wire(config: AgentConfig) {
  const tmux = new TmuxAdapter();
  const recent = new FileRecentStore(config.recentStorePath);
  const lister = new FsProjectLister();
  const hiddenFolders = new FileHiddenFoldersStore(config.hiddenFoldersPath);
  const repoRemote = new GitRepoRemote();
  const claudeSessions = new FileClaudeSessionsStore(config.claudeSessionsDir);
  return { tmux, recent, lister, hiddenFolders, repoRemote, claudeSessions };
}

// What `ls`, `spawn` and `peek` take from the process, injectable so tests reach no tmux server.
export interface CliIo {
  tmux?: TmuxPort;
  stdin?: () => Promise<string>;
  // A secret the operator types (echo off) or pipes in.
  secret?: (prompt: string) => Promise<string>;
  cwd?: string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  fetch?: typeof fetch;
  codex?: CodexSpawnPort;
  // Whether a command resolves through the login shell, as tmux will run it.
  resolveCommand?: (name: string) => Promise<boolean>;
  // Runs a script through the login shell; asked for CODEX_HOME when neither env has it.
  loginShell?: (script: string) => Promise<string>;
  update?: Partial<UpdateEffects>;
  // What `setup` reads and changes outside agent.env and ~/.tarfa.
  setup?: {
    service?: ServiceInstallPort;
    tailscale?: TailscalePort;
    portOwner?: (port: number) => Promise<PortOwner>;
    restart?: AgentServicePort;
    checkListener?: (port: number) => Promise<boolean>;
    // Source or package: decides where the service points and which agent.env is written.
    installKind?: InstallKind;
    agentLog?: AgentLog;
  };
}

const HOOKS_DIR = joinPath(packageRoot(), 'src', 'hooks');
const LAUNCHER_TEMPLATE = joinPath(packageRoot(), 'templates', 'tarfa-agent.sh');
const CLI_WRAPPER_TEMPLATE = joinPath(packageRoot(), 'templates', 'tarfa-cli-wrapper.sh');

async function cliState(home: string, env: NodeJS.ProcessEnv): Promise<CliState> {
  const bin = joinPath(home, '.local', 'bin');
  const wrapperPath = joinPath(bin, 'tarfa');
  const perchPath = joinPath(bin, 'perch');
  return {
    bin,
    onPath: (env.PATH ?? '').split(':').includes(bin),
    winner: await firstOnPath('tarfa', env.PATH ?? ''),
    wrapper: { path: wrapperPath, real: joinPath(await realpath(bin).catch(() => bin), 'tarfa'), template: await readFile(CLI_WRAPPER_TEMPLATE, 'utf8'), entry: await readCliEntry(wrapperPath) },
    perch: { path: perchPath, entry: await readCliEntry(perchPath) },
  };
}
const CODEX_NEXT_STEP = 'open Codex and trust the Tarfa hooks in /hooks; repeat after any hook change';

export async function run(argv: string[], rawEnv: NodeJS.ProcessEnv, home: string, io: CliIo = {}): Promise<string> {
  const env = withLegacyEnv(rawEnv);
  if (argv[0] === undefined || argv[0] === '--help' || argv[0] === '-h' || argv[0] === 'help') return HELP;
  if (argv[0] === '--version' || argv[0] === '-v') return packageVersion();
  // A bare `serve` never reaches here (the entrypoint starts the agent); with anything after it,
  // starting a second agent would replace ~/.tarfa/token under the running one.
  if (argv[0] === 'serve') throw new UsageError('usage: tarfa serve   (no options: runs the agent in the foreground, as the service does)');
  if (!COMMANDS.has(argv[0])) throw new UsageError(`unknown command: ${argv[0]} (run \`tarfa --help\`)`);
  if (argv[0] === 'setup') return setup(argv.slice(1), env, home, io);
  if (argv[0] === 'apply') return apply(argv.slice(1), env, home, io);
  if (argv[0] === 'update') return update(argv.slice(1), env, home, io);
  if (argv[0] === 'connect' || argv[0] === 'relay-key' || (argv[0] === 'pair' && argv.includes('--relay'))) {
    throw new UsageError(RELAYS_GONE);
  }
  if (argv[0] === 'pair') return pair(argv.slice(1), env, home);
  if (argv[0] === 'ls' || argv[0] === 'spawn' || argv[0] === 'peek' || argv[0] === 'unpark' || argv[0] === 'rename' || argv[0] === 'send' || argv[0] === 'close' || argv[0] === 'wait') {
    return orchestration(argv[0], argv.slice(1), env, home, io);
  }
  const config = loadConfig({ ...env, ...(await agentEnvValues(env, home)) }, home);
  const { tmux, recent, lister, hiddenFolders, repoRemote, claudeSessions } = wire(config);
  const [command, ...rest] = argv;

  switch (command) {
    case 'list': {
      const hidden = await hiddenFolders.list();
      const workspaces = (
        await listWorkspaces({
          tmux,
          machineId: config.machineId,
          sessionPrefix: config.sessionPrefix,
          status: { get: () => undefined, getChangedAt: () => undefined, getUrgent: () => false },
          repoRemote,
          claudeSessions,
        })
      ).filter((w) => !isHiddenPath(w.projectPath, hidden));
      return JSON.stringify(workspaces, null, 2);
    }
    case 'create': {
      const projectPath = rest[0];
      if (!projectPath) throw new Error('usage: tarfa create <projectPath> [command]');
      const cmd = rest[1] ?? 'claude';
      const ws = await createWorkspace(
        {
          tmux,
          recent,
          resolvePath: systemPathResolver,
          isDirectory: fsIsDirectory,
          clock: systemClock,
          ids: new ShortWorkspaceIds({
            tmux,
            sessionPrefix: config.sessionPrefix,
            parked: new FileParkedStore(config.parkedStorePath),
            status: readOnlyStatus(config.statusStorePath),
            claudeSessions,
          }),
          machineId: config.machineId,
        },
        { projectPath, command: cmd },
      );
      return JSON.stringify(ws, null, 2);
    }
    case 'recent': {
      const hidden = await hiddenFolders.list();
      return JSON.stringify(await getRecentPaths({ recent, hidden }), null, 2);
    }
    case 'browse': {
      const path = rest[0];
      if (!path) throw new Error('usage: tarfa browse <path>');
      const hidden = await hiddenFolders.list();
      return JSON.stringify(await browseDir({ lister, hidden }, path, config.projectRoots), null, 2);
    }
    case 'install-hooks': {
      const hooks = hooksFiles(home, HOOKS_DIR, config.port, await resolveCodexHome({ ...env, ...(await agentEnvValues(env, home)) }, home, io.loginShell));
      const { codex } = await hooks.install();
      // Codex runs no hook until the user trusts it (keyed on a hash it does not document), so
      // that step stays with the user.
      if (!codex) return JSON.stringify({ installed: hooks.settingsPath, scriptPath: hooks.scriptPath });
      return JSON.stringify({
        installed: hooks.settingsPath,
        codexInstalled: hooks.codexHooksPath,
        codexNextStep: CODEX_NEXT_STEP,
        scriptPath: hooks.scriptPath,
      });
    }
    case 'devices':
      return devices(new FileDeviceStore(config.devicesPath), rest);
    case 'dictation-key':
      return dictationKey(new FileDictationKeysStore(config.dictationKeysPath), rest, io.secret ?? readSecret);
    default:
      throw new UsageError(`unknown command: ${command} (run \`tarfa --help\`)`);
  }
}

const HELP = `usage: tarfa <command> [options]   (\`tarfa setup --help\`, \`tarfa apply --help\` and \`tarfa update --help\` list their flags)

Set up this machine:
  setup          write agent.env, the agent key, the service and the hooks, then check the phone port
  pair           print a one-time pairing code and QR code for a phone (--link: a link, for an older app)
  devices        list, revoke or forget paired phones; open or close enrolment
  dictation-key  store the ElevenLabs or OpenRouter key every paired phone dictates with
  update         install the newest @tarfa/cli and apply it (package installs)
  apply          rewrite the launcher and service if they changed, reinstall the hooks, restart
  install-hooks  install the Claude Code and Codex hooks that report each workspace's status
  serve          run the agent in the foreground (what the service runs)

Workspaces on this machine:
  ls             list workspaces and their state
  spawn          open a workspace on a project with a brief on stdin (--child to orchestrate it)
  peek           print the end of a workspace's screen
  wait           wait until one of the workspaces stops working
  send           send a message to another workspace
  unpark         reopen parked workspaces
  rename         rename a workspace (without an id: this one)
  close          close workspaces
  list, create, recent, browse   the agent's own views, as JSON

  --version      print the version`;

const COMMANDS = new Set([
  'setup', 'apply', 'update', 'pair', 'connect', 'relay-key', 'devices', 'dictation-key', 'install-hooks',
  'ls', 'spawn', 'peek', 'unpark', 'rename', 'send', 'close', 'wait',
  'list', 'create', 'recent', 'browse',
]);

const LS_USAGE = `usage: tarfa ls [--json] [--mine] [--parent <workspace id>] [--role ${WORKSPACE_ROLES.join('|')}] [--path <project dir>]`;
const SPAWN_USAGE = 'usage: tarfa spawn [--title <title>] [--child] [--model <model>] [--cli claude|codex|pi] <projectPath>   (brief on stdin)';
const SPAWN_CLIS: readonly AgentCli[] = ['claude', 'codex', 'pi'];
const PEEK_USAGE = 'usage: tarfa peek <workspace id> [-n <lines>]';
const UNPARK_USAGE = 'usage: tarfa unpark <workspace id>...';
const RENAME_USAGE = 'usage: tarfa rename [<workspace id>] <title>   (without an id: the workspace this runs in)';
const SEND_USAGE = 'usage: tarfa send <workspace id> "<message>"   (or the message on stdin)';
const CLOSE_USAGE = 'usage: tarfa close <workspace id>...';
const WAIT_USAGE = 'usage: tarfa wait <workspace id>... [--timeout <seconds, at least 10>]';

// `ls`, `spawn` and `peek` serve sessions in any repo, so none of them needs deploy/agent.env:
// it only lends the machine id, and the store paths come from $HOME.
async function orchestration(command: 'ls' | 'spawn' | 'peek' | 'unpark' | 'rename' | 'send' | 'close' | 'wait', argv: string[], env: NodeJS.ProcessEnv, home: string, io: CliIo): Promise<string> {
  const values = await agentEnvValues(env, home).catch(() => ({}) as Record<string, string>);
  const config = loadConfig({ TARFA_MACHINE_ID: hostname().split('.')[0], ...env, ...values }, home);
  const tmux = io.tmux ?? new TmuxAdapter();
  const claudeSessions = new FileClaudeSessionsStore(config.claudeSessionsDir);
  const args = [...argv];
  const flag = (name: string) => {
    const at = args.indexOf(name);
    if (at !== -1) args.splice(at, 1);
    return at !== -1;
  };
  const listAll = () => {
    const status = readOnlyStatus(config.statusStorePath);
    return listWorkspaces({
      tmux,
      machineId: config.machineId,
      sessionPrefix: config.sessionPrefix,
      status,
      parked: new FileParkedStore(config.parkedStorePath),
      claudeSessions,
      messagedLast: { has: (id) => status.getMessagedLast(id) },
    });
  };
  const list = async () => {
    const hidden = await new FileHiddenFoldersStore(config.hiddenFoldersPath).list();
    const workspaces = await listAll();
    const shown = workspaces.filter((w) => !isHiddenPath(w.projectPath, hidden));
    return shown.map((w) => ({ ...w, role: workspaceRole(w, shown) }));
  };
  const table = (workspaces: Awaited<ReturnType<typeof list>>) =>
    formatWorkspaceTable(workspaces, { now: (io.now ?? Date.now)(), home });

  switch (command) {
    case 'ls': {
      const json = flag('--json');
      const mine = flag('--mine');
      const parent = takeOption(args, '--parent', LS_USAGE);
      const role = takeOption(args, '--role', LS_USAGE);
      const path = takeOption(args, '--path', LS_USAGE);
      if (args.length > 0 || (role !== undefined && !WORKSPACE_ROLES.includes(role as WorkspaceRole))) throw new Error(LS_USAGE);
      const of = mine ? await callerWorkspace(env, tmux, config.sessionPrefix) : parent;
      const given = path === undefined ? undefined : resolvePath(io.cwd ?? process.cwd(), path);
      // spawn stores the resolved folder, a workspace made from the phone the one it was given.
      const dirs = given === undefined ? undefined : [given, await realpath(given).catch(() => given)];
      const workspaces = (await list()).filter(
        (w) =>
          (of === undefined || w.parentId === of) &&
          (role === undefined || w.role === role) &&
          (dirs === undefined || dirs.some((dir) => isUnderPath(w.projectPath, dir))),
      );
      return json ? JSON.stringify(workspaces, null, 2) : table(workspaces);
    }
    case 'spawn': {
      const child = flag('--child');
      const title = takeOption(args, '--title', SPAWN_USAGE);
      const model = takeOption(args, '--model', SPAWN_USAGE);
      const cli = takeOption(args, '--cli', SPAWN_USAGE) ?? 'claude';
      const [projectPath, ...extra] = args;
      if (!projectPath || extra.length > 0 || projectPath.startsWith('--')) throw new Error(SPAWN_USAGE);
      if (!SPAWN_CLIS.includes(cli as AgentCli)) throw new Error(SPAWN_USAGE);
      const cwd = io.cwd ?? process.cwd();
      const resolveDirectory = fsResolveDirectory(cwd);
      if (!(await resolveDirectory(projectPath))) throw new Error(`not a directory: ${resolvePath(cwd, projectPath)}`);
      // Without it the pane's command fails at once and the workspace vanishes with no trace.
      if (cli === 'pi' && !(await (io.resolveCommand ?? loginShellResolver())('pi-reviewed'))) {
        throw new Error('tarfa spawn --cli pi needs pi-reviewed on PATH');
      }
      const parentId = child ? await callerWorkspace(env, tmux, config.sessionPrefix) : undefined;
      const brief = await (io.stdin ?? (() => readStdin("pass the brief on stdin, e.g. tarfa spawn <path> <<'EOF'")))();
      return spawnWorkspace(
        {
          tmux: withSpawnMethods(tmux),
          files: new FsFileWriter(),
          resolveDirectory,
          ids: new ShortWorkspaceIds({
            tmux,
            sessionPrefix: config.sessionPrefix,
            parked: new FileParkedStore(config.parkedStorePath),
            status: readOnlyStatus(config.statusStorePath),
            claudeSessions,
          }),
          nonce: () => randomBytes(6).toString('hex'),
          sleep: io.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
          spawnDir: joinPath(config.stateDir, 'spawn'),
          codex: io.codex ?? (codexSpawn({ ...env, ...values }, home, io)),
        },
        {
          projectPath,
          brief,
          cli: cli as AgentCli,
          ...(model ? { model } : {}),
          ...(title ? { title } : {}),
          ...(parentId ? { parent: { id: parentId } } : {}),
        },
      );
    }
    case 'peek': {
      const n = takeOption(args, '-n', PEEK_USAGE);
      const lines = n === undefined ? 40 : Number(n);
      const [id, ...extra] = args;
      if (!id || extra.length > 0 || !Number.isInteger(lines) || lines < 1) throw new Error(PEEK_USAGE);
      const workspace = (await list()).find((w) => w.id === id);
      if (!workspace) throw new Error(`no workspace ${id} (see tarfa ls)`);
      if (workspace.status === 'parked') {
        return `${table([workspace])}\n\n(parked: no pane until it is opened)`;
      }
      if (!tmux.capturePane) throw new Error('this tmux adapter cannot capture a pane');
      // History beyond N rows, since a full-screen UI leaves many of its rows blank.
      const text = await tmux.capturePane(id, lines * 4);
      const tail = text.split('\n').filter((line) => line.trim().length > 0).slice(-lines);
      return [table([workspace]), '', ...tail].join('\n');
    }
    case 'unpark': {
      if (args.length === 0 || args.some((id) => id.startsWith('-'))) throw new Error(UNPARK_USAGE);
      const post = agentPost(config.port, config.stateDir, io.fetch ?? fetch);
      const lines: string[] = [];
      let failed = false;
      for (const id of args) {
        const { status, json } = await post('/unpark', { id });
        const result = json.result;
        if (status !== 200 || typeof result !== 'string') {
          throw new Error(`${id}: the agent answered ${status}${json.error ? ` (${json.error})` : ''}`);
        }
        failed ||= result !== 'unparked';
        lines.push(`${id}: ${UNPARK_WORDS[result] ?? result}`);
      }
      if (failed) throw new Error(lines.join('\n'));
      return lines.join('\n');
    }
    case 'send': {
      const [to, message, ...extra] = args;
      if (!to || to.startsWith('-') || extra.length > 0 || args.some((a) => a === '-f' || a === '--file' || a.startsWith('--file='))) {
        throw new Error(SEND_USAGE);
      }
      // Codex under its daemon runs this outside the pane, with a stale TMUX_PANE or none; its
      // thread id names the sender instead.
      const codexThread = env.CODEX_THREAD_ID || undefined;
      const pane = env.TMUX_PANE ?? '';
      if (!pane && !codexThread) throw new Error('not inside a Tarfa workspace: $TMUX_PANE is unset');
      const body = message ?? (await (io.stdin ?? (() => readStdin(`pass the message as an argument or on stdin: ${SEND_USAGE}`)))());
      const { status, json } = await agentPost(config.port, config.stateDir, io.fetch ?? fetch)('/message', {
        pane,
        pid: process.pid,
        to,
        body,
        ...(codexThread ? { codexThread } : {}),
      });
      if (status === 200 && json.result === 'delivered') return `delivered to ${to}`;
      if (status === 200 && json.result === 'refused' && typeof json.reason === 'string') throw new Error(json.reason);
      throw new Error(`the agent answered ${status}${status === 404 ? ' (it predates tarfa send: restart it)' : ''}${json.error ? ` (${json.error})` : ''}`);
    }
    case 'rename': {
      if (args.length === 0) throw new Error(RENAME_USAGE);
      // A first word naming a workspace is its id; otherwise every word is the title. One shaped
      // like an id that names nothing is refused, not taken into the caller's title.
      const named = args.length > 1 && (await list()).some((w) => w.id === args[0]);
      if (args.length > 1 && !named && /^[a-z0-9_][a-z0-9_-]*-(?:\d+|[0-9a-f]{6})$/.test(args[0]!)) {
        throw new Error(`no workspace ${args[0]} (see tarfa ls), or quote the title: tarfa rename "${args.join(' ')}"`);
      }
      const id = named ? args[0]! : await callerWorkspace(env, tmux, config.sessionPrefix);
      const title = (named ? args.slice(1) : args).join(' ');
      const { locked } = await renameWorkspace(
        { tmux: withSpawnMethods(tmux), parked: new FileParkedStore(config.parkedStorePath) },
        id,
        title,
      );
      const done = `${id}: renamed to "${title.trim()}"`;
      return locked ? done : `${done} (this tmux cannot lock a title, so Claude may rename it again)`;
    }
    case 'close': {
      if (args.length === 0 || args.some((id) => id.startsWith('-'))) throw new UsageError(CLOSE_USAGE);
      const self = await callerWorkspace(env, tmux, config.sessionPrefix).catch(() => undefined);
      if (self !== undefined && args.includes(self)) {
        throw new Error(`${self} is this workspace: a close would kill this command; close it from another workspace or the phone`);
      }
      const post = agentPost(config.port, config.stateDir, io.fetch ?? fetch);
      const lines: string[] = [];
      let failed = false;
      for (const id of args) {
        const { status, json } = await post('/close', { id });
        if (status !== 200 || typeof json.result !== 'string') {
          const why = status === 404 ? ' (it predates tarfa close: restart it)' : json.error ? ` (${json.error})` : '';
          throw new Error([...lines, `${id}: the agent answered ${status}${why}`].join('\n'));
        }
        failed ||= json.result !== 'closed';
        lines.push(`${id}: ${json.result === 'closed' ? 'closed' : 'no such workspace (see tarfa ls)'}`);
      }
      if (failed) throw new Error(lines.join('\n'));
      return lines.join('\n');
    }
    case 'wait': {
      const timeoutArg = takeOption(args, '--timeout', WAIT_USAGE, UsageError);
      const timeout = timeoutArg === undefined ? undefined : Number(timeoutArg);
      if (args.length === 0 || args.some((id) => id.startsWith('-')) || (timeout !== undefined && !(timeout * 1000 >= WAIT_SETTLE_MS))) {
        throw new UsageError(WAIT_USAGE);
      }
      const now = io.now ?? Date.now;
      const sleep = io.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
      const startedAt = now();
      const tracker = new WaitTracker(args, startedAt);
      for (let first = true; ; first = false) {
        const workspaces = await listAll();
        // tmux reports a socket it may not open as it does no server, so a sandbox would read as
        // every child gone. Whoever waits normally runs in a session of that same server.
        if (first && workspaces.every((w) => w.status === 'parked') && (await tmux.listSessions(config.sessionPrefix)).length === 0) {
          throw new Error('tmux lists no session at all: no server is running, or a sandbox blocks its socket (run this outside the sandbox)');
        }
        const reports = tracker.observe(workspaces, now());
        if (reports.length > 0) return reports.map((r) => `${r.id} ${r.state}`).join('\n');
        const left = timeout === undefined ? WAIT_POLL_MS : startedAt + timeout * 1000 - now();
        if (left <= 0) throw new WaitTimeout(`timed out after ${timeout}s, no stop to report: ${args.join(' ')}`);
        await sleep(Math.min(left, WAIT_POLL_MS));
      }
    }
  }
}

const UNPARK_WORDS: Record<string, string> = {
  unparked: 'opened',
  'not-parked': 'not parked',
  'missing-directory': 'its project directory no longer exists',
};

// `unpark`, `close` and `send` go through the running agent, the one process that writes status.json (it
// holds it in memory, so a write from here would be overwritten) and parked.json, and the one
// that tells the phones. It authenticates with the hooks secret the agent writes at each start.
function agentPost(port: number, stateDir: string, fetchFn: typeof fetch) {
  // An agent restart is the usual cause, so the sender should retry, not reach for another route.
  const notRunning = `the Tarfa agent is not running (nothing answered on 127.0.0.1:${port})`;
  const retry = '; retry in a few seconds';
  let token: Promise<string> | undefined;
  return async (route: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> => {
    token ??= readFile(joinPath(stateDir, 'token'), 'utf8').then(
      (text) => text.trim(),
      () => {
        throw new Error(`${notRunning}: no ${joinPath(stateDir, 'token')}${retry}`);
      },
    );
    const secret = await token;
    let res: Response;
    try {
      res = await fetchFn(`http://127.0.0.1:${port}${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
        body: JSON.stringify(body),
      });
    } catch {
      throw new Error(`${notRunning}${retry}`);
    }
    if (res.status === 401) throw new Error('the agent refused the hooks secret: was it restarted since ~/.tarfa/token was read?');
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: res.status, json };
  };
}

// The workspace the caller's own pane belongs to. Targeted at $TMUX_PANE: an untargeted
// display-message answers for whichever session was most recently active. Codex under its daemon
// runs tools outside the pane with a stale TMUX_PANE, so its thread names the caller instead.
async function callerWorkspace(env: NodeJS.ProcessEnv, tmux: TmuxPort, sessionPrefix: string): Promise<string> {
  const thread = env.CODEX_THREAD_ID;
  if (thread) {
    const session = sessionOfCodexThread(await tmux.listSessions(sessionPrefix), thread);
    if (!session) throw new Error(`not inside a Tarfa workspace: no workspace records Codex thread ${thread}`);
    return session.name;
  }
  const pane = env.TMUX_PANE;
  if (!pane) throw new Error('not inside a Tarfa workspace: $TMUX_PANE is unset');
  const session = tmux.sessionOfPane ? await tmux.sessionOfPane(pane) : null;
  const ours = session !== null && (await tmux.listSessions(sessionPrefix)).some((s) => s.name === session);
  if (!session || !ours) {
    throw new Error(`not inside a Tarfa workspace: this pane's tmux session is ${session ?? 'unknown'}`);
  }
  return session;
}

function withSpawnMethods(tmux: TmuxPort) {
  const { setPaneTitle } = tmux;
  if (!setPaneTitle) throw new Error('this tmux adapter cannot set a pane title');
  return {
    createSession: tmux.createSession.bind(tmux),
    hasSession: tmux.hasSession.bind(tmux),
    setPaneTitle: setPaneTitle.bind(tmux),
    supportsTitleLock: tmux.supportsTitleLock?.bind(tmux),
    lockPaneTitle: tmux.lockPaneTitle?.bind(tmux),
  };
}

// Read-only: nothing here ever calls set or prune, so the agent's file is never rewritten. A
// file that cannot be read at all (a directory, no permission) reads as no statuses.
function readOnlyStatus(path: string): Pick<StatusStorePort, 'get' | 'getChangedAt' | 'getUrgent' | 'getMessagedLast' | 'ids'> {
  try {
    return new FileStatusStore(path);
  } catch {
    return { get: () => undefined, getChangedAt: () => undefined, getUrgent: () => false, getMessagedLast: () => false, ids: () => [] };
  }
}

async function readStdin(ttyError: string): Promise<string> {
  if (process.stdin.isTTY) throw new Error(ttyError);
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

const RELAYS_GONE = 'relays are gone: tarfa setup sets a machine up for phones, and tarfa pair pairs one';
// The longest machine name a phone takes from a pairing code or link.
const MAX_PAIRING_NAME = 64;
const PAIR_USAGE = `usage: tarfa pair [--pwa <PWA origin>] [--ttl <minutes, 1-${PAIRING_TTL_MS / 60_000}, default ${PAIRING_TTL_MS / 60_000}>] [--link]`;

function takeOption(args: string[], name: string, usage: string, Failure: new (message: string) => Error = Error): string | undefined {
  const at = args.indexOf(name);
  if (at === -1) return undefined;
  const value = args[at + 1];
  if (!value || value.startsWith('--')) throw new Failure(usage);
  args.splice(at, 2);
  return value;
}

function pwaOrigin(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`--pwa must be the origin the phone opens Tarfa at, e.g. https://host:8443 (got ${value})`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(`--pwa must be an http(s) origin (got ${value})`);
  return url.origin;
}

// What the service reads, over the shell's environment: a shell inside a workspace has none of
// the agent's variables, or a stale copy of them. No agent.env (a machine not set up as a
// service) leaves the environment alone.
// Resolved only when a Codex workspace is spawned. The version probe gets the CODEX_HOME the
// thread is created under, so both name one daemon.
function codexSpawn(env: Record<string, string | undefined>, home: string, io: CliIo): CodexSpawnPort {
  let codexHome: Promise<string> | undefined;
  const resolve = () => (codexHome ??= resolveCodexHome(env, home, io.loginShell));
  return {
    home: resolve,
    versions: async () => codexVersions(loginShell(undefined, { CODEX_HOME: await resolve() }))(),
    createThread: async (input) => new CodexAppServer({ codexHome: await resolve() }).createThread(input),
  };
}

async function agentEnvValues(env: NodeJS.ProcessEnv, home: string): Promise<Record<string, string>> {
  try {
    return withLegacyEnv(parseEnvFile(await readFile(await locateAgentEnv(env, home), 'utf8'))) as Record<string, string>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }
}

// `tarfa pair` reads the agent.env the service reads rather than expecting it in the shell's
// environment.
async function pair(argv: string[], env: NodeJS.ProcessEnv, home: string): Promise<string> {
  const args = [...argv];
  const config = loadConfig({ ...env, ...(await agentEnvValues(env, home)) }, home);
  let origin = pwaOrigin(takeOption(args, '--pwa', PAIR_USAGE));
  const ttl = takeOption(args, '--ttl', PAIR_USAGE) ?? String(PAIRING_TTL_MS / 60_000);
  const linkAt = args.indexOf('--link');
  if (linkAt !== -1) args.splice(linkAt, 1);
  const minutes = Number(ttl);
  if (!/^\d+$/.test(ttl) || minutes < 1 || minutes * 60_000 > PAIRING_TTL_MS) throw new Error(`--ttl takes whole minutes from 1 to ${PAIRING_TTL_MS / 60_000} (got ${ttl})`);
  if (args.length > 0) throw new Error(PAIR_USAGE);
  try {
    origin ??= pwaOrigin(config.pwaOrigin)!;
  } catch {
    throw new Error(`TARFA_PWA_ORIGIN in agent.env must be the http(s) origin phones open the app at (got ${config.pwaOrigin})`);
  }
  if (config.phoneAddresses.length === 0) {
    throw new Error('this machine has no TARFA_PHONE_ADDRESSES: run tarfa setup first (tarfa setup --help)');
  }
  const bad = config.phoneAddresses.find((url) => !isMachineUrl(url));
  if (bad) throw new Error(`TARFA_PHONE_ADDRESSES holds ${bad}, which a phone refuses: wss://<host>[:port][/<slug>] (run tarfa setup)`);
  if (config.phoneAddresses.length > MAX_ADDRESSES) throw new Error(`TARFA_PHONE_ADDRESSES holds more than ${MAX_ADDRESSES} addresses`);
  // Refused before a secret is stored, like every other field a phone would refuse.
  const machineId = pairingName(config.machineId, hostname());
  if (machineId.trim().length > MAX_PAIRING_NAME) throw new Error(`TARFA_MACHINE_ID must be at most ${MAX_PAIRING_NAME} characters, the name phones show (got ${machineId.length})`);
  const pairing = await mintPairing(
    {
      keys: await loadOrCreateAgentKeys(config.agentKeyPath),
      machineId,
      ...(config.defaultPath ? { defaultPath: config.defaultPath } : {}),
      pairings: new FilePairingStore(config.pairingPath),
      newSecret: generatePairingSecret,
      now: () => new Date(),
      ttlMs: minutes * 60_000,
    },
    { phoneUrls: config.phoneAddresses },
  );
  return pairingInstructions(pairing, { origin, minutes, link: linkAt !== -1 });
}

// The exit code `timeout(1)` uses, so a script can tell it from a stop (0) or a failure (1, 2).
export class WaitTimeout extends Error {
  readonly exitCode = 124;
}

export class UsageError extends Error {
  readonly exitCode = 2;
}

export const SETUP_USAGE = `usage: tarfa setup --machine-id <id> --project-roots <dir,dir> [options]

Sets this machine up as a Tarfa agent, without prompting: agent.env (backed up first; ~/.tarfa/agent.env
for an installed package), the launcher the service runs (~/.tarfa/bin/tarfa-agent), the
agent key, a new device roster that admits pairing codes only (an existing one is kept), the service started at boot (systemd
user unit with linger, or launchd), the Claude Code hooks, and optionally a Tailscale address for
phones. Rerunning it with the same flags, or with none, changes nothing: --machine-id, --project-roots,
--phone-port and --default-path default to what the agent.env it finds holds. It refuses rather than
replace anything it did not make (an agent key, another tailscale serve entry).

  --machine-id <id>             the name phones show for this machine
  --project-roots <dir,dir>     absolute folders new workspaces may be made in
  --default-path <dir>          where a phone resolves relative paths (sent when pairing)
  --phone-port <n>              loopback port phones reach (default 8797); every Linux user on one
                                machine needs their own, e.g. 8797 and 8798
  --tailscale funnel|serve|none how phones reach this machine: with or without Tailscale (funnel,
                                public through Funnel), only with Tailscale on (serve), or through an
                                address published some other way (none, with --address). Ask the
                                operator. Without it, setup keeps the TARFA_PHONE_ADDRESSES or the
                                serve handler for the phone port the machine already has, picks
                                funnel for a machine phones reached through a relay, and otherwise
                                refuses. Every run prints a reachability: line saying which
  --tailscale-port <n>          the HTTPS port Tailscale serves it on (default 443 for serve, 10000
                                for funnel; Funnel allows only 443, 8443 and 10000)
  --slug <name>                 serve under /<name>, so several agents share one port
  --address <wss-url>           another address phones try, after the Tailscale one (repeatable,
                                4 in all), e.g. a reverse proxy
  --pwa <origin>                where phones open the app (default https://tarfa.app; an existing
                                TARFA_PWA_ORIGIN is kept unless this is given)
  --pair                        print a pairing code and QR code at the end
  --adopt                       a machine whose service runs a clone's deploy/run-agent.sh: move it to
                                the installed package (copies deploy/agent.env to ~/.tarfa/agent.env,
                                keeps the original, repoints the service, replaces the ~/.local/bin links
                                with a wrapper). Run from the package only; setup does it by itself when
                                it finds such a service, and every flag you do not give is read from that
                                env, so no phone pairs again
  --dry-run                     print the plan and the Tailscale checks; change nothing

Tailscale, once per node:
  1. Install Tailscale and run \`tailscale up\`.
  2. In the admin console (DNS page): turn on MagicDNS and HTTPS certificates.
  3. For --tailscale funnel: give the node the funnel attribute in the policy file, e.g.
       "nodeAttrs": [{ "target": ["<you or the node's tag>"], "attr": ["funnel"] }]
     Funnel serves only ports 443, 8443 and 10000.
  4. If Tailscale says it needs root, make yourself its operator once:
       sudo tailscale set --operator=$USER
Several agents on one node (one per Linux user) share a Tailscale port, each under its own --slug.
The node has one operator: a second user runs \`--tailscale none --slug <name> --address <url>\`
with their own --phone-port, and setup prints the \`tailscale serve\` line for the operator to run:
on the port of that --address (or --tailscale-port), as \`tailscale funnel\` when the port is already
on Funnel. Run as another user (sudo -u), set XDG_RUNTIME_DIR=/run/user/<uid>.

Related: \`tarfa apply\` brings the service and hooks in line with the installed package and checks
the agent came back; \`tarfa update\` installs a newer release with mise, then runs its apply.

Example:
  tarfa setup --machine-id dev --project-roots ~/workspace --tailscale funnel --slug me --pair`;

async function setup(argv: string[], env: NodeJS.ProcessEnv, home: string, io: CliIo): Promise<string> {
  if (argv.includes('--help') || argv.includes('-h')) return SETUP_USAGE;
  const kind = io.setup?.installKind ?? installKind();
  const adoptRequested = argv.includes('--adopt');
  if (adoptRequested && kind === 'clone') {
    throw new UsageError('tarfa setup --adopt runs from the installed package: run `mise use -g npm:@tarfa/cli@<v>`, then `tarfa setup --adopt`');
  }
  const launcherPath = joinPath(home, '.tarfa', 'bin', 'tarfa-agent');
  const packageEnv = joinPath(home, '.tarfa', 'agent.env');
  if (kind === 'package' && env.TARFA_AGENT_ENV && resolvePath(env.TARFA_AGENT_ENV) !== packageEnv) {
    throw new Error(`TARFA_AGENT_ENV names ${env.TARFA_AGENT_ENV}, but the service launcher always reads ${packageEnv}: unset TARFA_AGENT_ENV, then run tarfa setup again`);
  }
  const fx = io.setup ?? {};
  const service = fx.service ?? serviceInstall({ home, user: userInfo().username, uid: process.getuid?.() ?? 0 });
  const installedUnit = await service.installed();
  // A machine still on the unit from before the rename is adopted through the same swap.
  const runningUnit = installedUnit ?? (await service.legacyText());
  const cloneRepo = kind === 'package' ? cloneOfUnit(service.kind, runningUnit) : null;
  if (adoptRequested && cloneRepo === null) {
    if (runningUnit === null) throw new Error('--adopt: no agent service is installed, so there is nothing to adopt: run tarfa setup with its flags (tarfa setup --help)');
    if (!unitRunsLauncher(service.kind, runningUnit, launcherPath)) {
      throw new Error("--adopt: the installed service runs neither a clone's deploy/run-agent.sh nor the launcher, so there is nothing to adopt");
    }
  }

  const stateEnvPath = joinPath(home, '.tarfa', 'agent.env');
  const envPath = cloneRepo !== null ? stateEnvPath : await locateAgentEnv(env, home, kind);
  const readText = (path: string) =>
    readFile(path, 'utf8').catch((err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') return null;
      throw err;
    });
  const copyEnv = cloneRepo !== null && (await readText(stateEnvPath)) === null;
  let envText: string | null;
  if (cloneRepo !== null && copyEnv) {
    envText = await readText(joinPath(cloneRepo, 'deploy', 'agent.env'));
    if (envText === null) throw new Error(`the service runs ${cloneRepo}/deploy/run-agent.sh, which has no deploy/agent.env to adopt: restore it, or run tarfa setup with its flags`);
  } else {
    envText = await readText(envPath);
  }

  // A flag not given takes what the machine already runs (the agent.env found above, or the one an
  // adoption copies), so a bare rerun plans nothing. How the port is published is not in agent.env:
  // planSetup infers it from what the machine holds (resolveReachability), or refuses.
  const given = withLegacyEnv(parseEnvFile(envText ?? ''));
  const filled = (name: string, value: string | undefined) => (value !== undefined && value !== '' && !argv.includes(name) ? [name, value] : []);
  const flags = parseSetupFlags([
    ...argv,
    ...filled('--machine-id', given.TARFA_MACHINE_ID),
    ...filled('--project-roots', given.TARFA_PROJECT_ROOTS?.split(':').join(',')),
    ...filled('--phone-port', given.TARFA_PHONE_PORT),
    ...filled('--default-path', given.TARFA_DEFAULT_PATH),
  ]);
  if ('error' in flags) {
    const read = cloneRepo !== null && copyEnv ? joinPath(cloneRepo, 'deploy', 'agent.env') : envPath;
    const source = envText === null ? `there is no ${read} yet to read them from` : `a value not given as a flag is read from ${read}`;
    throw new UsageError(`${flags.error} (${source})\n\n${SETUP_USAGE.split('\n')[0]}\n(tarfa setup --help for every option)`);
  }

  const repo = await mainCheckout(kind);
  const config = loadConfig({ ...withLegacyEnv(parseEnvFile(envText ?? '')), TARFA_MACHINE_ID: flags.machineId }, home);
  const tailscale = fx.tailscale ?? tailscaleCli();
  const owner = fx.portOwner ?? portOwner;
  const hooks = hooksFiles(home, HOOKS_DIR, config.port, await resolveCodexHome({ ...env, ...withLegacyEnv(parseEnvFile(envText ?? '')) }, home, io.loginShell));
  const devices = new FileDeviceStore(config.devicesPath);
  const hasRoster = await readFile(config.devicesPath).then(() => true, () => false);

  const agentLivePath = cloneRepo === null ? '' : joinPath(cloneRepo, 'deploy', 'agent-live');
  const state: SetupState = {
    install: kind,
    repo,
    launcher: {
      path: launcherPath,
      template: await readFile(LAUNCHER_TEMPLATE, 'utf8'),
      installed: await readFile(launcherPath, 'utf8').catch(() => null),
    },
    service: { kind: service.kind, template: await service.template(), installed: installedUnit, enabled: await service.enabled() },
    envPath,
    envText,
    hasKey: await readFile(config.agentKeyPath).then(() => true, () => false),
    roster: hasRoster ? enrolmentMode(await devices.read()) : 'absent',
    hooksCurrent: await hooks.current(),
    legacyService: await service.legacyInstalled(),
    stateDir: stateDirLayout(home),
    phonePortOwner: await owner(flags.phonePort),
    hooksPortOwner: await owner(config.port),
    // Read whatever --tailscale says: they settle how the port is published when no flag does, and word
    // whether phones need Tailscale. Both answer null when Tailscale is absent or will not tell.
    tailscale: await tailscale.status(),
    serve: await tailscale.serveStatus(),
    cli: kind === 'package' ? await cliState(home, env) : null,
    adoption: cloneRepo === null ? null : { repo: cloneRepo, copyEnv, agentLive: { path: agentLivePath, kind: await linkKind(agentLivePath) } },
  };
  const plan = planSetup(flags, state);
  if ('error' in plan) throw new Error(plan.error);

  const envFile = agentEnvFile(envPath);
  const result = await runSetup(
    plan,
    {
      envPath,
      writeEnv: (text) => envFile.write(text),
      createKey: async () => {
        await loadOrCreateAgentKeys(config.agentKeyPath);
      },
      writeRoster: async () => {
        await mkdir(dirname(config.devicesPath), { recursive: true, mode: 0o700 });
        await devices.update((roster) => roster);
      },
      writeLauncher: (path, text) => atomicWrite(path, text, 0o755),
      copyEnv: (from, to) => copyEnvOnce(from, to),
      removeAgentLive: (path) => removeLink(path),
      installUnit: async (text, backup) => {
        const kept = backup ? await service.backup() : null;
        const ran = await service.install(text);
        return kept === null ? ran : [`kept the old service definition at ${kept} (a hand-added Environment= or other line is in that text; drop-ins stay in place)`, ...ran];
      },
      writeCliWrapper: (path, text) => atomicWrite(path, text, 0o755),
      linkPerch: (path) => linkPerch(path),
      stopLegacyService: () => service.stopLegacy(),
      moveState: async () => {
        await migrateStateDir(home);
      },
      removeLegacyService: () => service.removeLegacy(),
      installHooks: async () => {
        const { codex } = await hooks.install();
        if (codex) process.stderr.write(`${CODEX_NEXT_STEP}\n`);
      },
      serve: (entry) => tailscale.serve(entry),
      restart: () => (fx.restart ?? agentService()).restart(),
      checkListener: fx.checkListener ?? ((port) => answersUpgrade(port)),
      pair: () => pair([], env, home),
    },
    { dryRun: flags.dryRun, phonePort: flags.phonePort },
  );
  if (!result.ok) throw new Error(result.lines.join('\n'));
  return result.lines.join('\n');
}

export const UPDATE_USAGE = `usage: tarfa update [--version <x.y.z>] [--force]

Installs the newest @tarfa/cli (or --version, which may be older: a rollback) with mise, then runs
that version's \`tarfa apply\`. Refuses from a source install (git pull there). Does nothing when that
version is already installed, unless --force. Never updates Claude Code or Codex.
TARFA_NPM_REGISTRY names another registry to ask for the newest version.`;

async function update(argv: string[], env: NodeJS.ProcessEnv, home: string, io: CliIo): Promise<string> {
  if (argv.includes('--help') || argv.includes('-h')) return UPDATE_USAGE;
  let version: string | undefined;
  let force = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--force') force = true;
    else if (argv[i] === '--version' && argv[i + 1] !== undefined) version = argv[++i];
    else throw new UsageError(UPDATE_USAGE);
  }
  const mise = miseCli(home);
  const registry = npmRegistry({ ...(io.fetch ? { fetch: io.fetch } : {}), ...(env.TARFA_NPM_REGISTRY ? { registry: env.TARFA_NPM_REGISTRY } : {}) });
  const effects: UpdateEffects = {
    installKind: () => io.setup?.installKind ?? installKind(),
    currentVersion: () => packageVersion(),
    findMise: () => findMise(home, env.PATH),
    latest: () => registry.latest(),
    install: mise.install,
    locate: mise.locate,
    apply: mise.apply,
    log: (line) => void process.stdout.write(`${line}\n`),
    ...io.update,
  };
  const result = await runUpdate(effects, { ...(version !== undefined ? { version } : {}), force });
  if (result.exitCode !== 0) throw Object.assign(new Error(result.message), { exitCode: result.exitCode });
  return result.message;
}

export const APPLY_USAGE = `usage: tarfa apply

After upgrading the package: rewrites the launcher and the service definition if they differ,
reinstalls the hooks, restarts the agent, and checks that the phone port answers and the agent's
log shows "phones on". One line per step; it stops at the first failure (exit 1).`;

async function apply(argv: string[], env: NodeJS.ProcessEnv, home: string, io: CliIo): Promise<string> {
  if (argv.includes('--help') || argv.includes('-h')) return APPLY_USAGE;
  if (argv.length > 0) throw new UsageError(APPLY_USAGE);
  const fx = io.setup ?? {};
  if ((fx.installKind ?? installKind()) === 'clone') {
    throw new UsageError('tarfa apply: this is a source install, and apply would point the service at a release that may not be installed. Use tarfa setup (or install the package)');
  }
  const envPath = await locateAgentEnv(env, home, 'package');
  const envText = await readFile(envPath, 'utf8').catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') return null;
    throw err;
  });
  if (envText === null) throw new Error(`failed: check: no agent config at ${envPath}: run tarfa setup`);
  const config = loadConfig(withLegacyEnv(parseEnvFile(envText)), home);
  const service = fx.service ?? serviceInstall({ home, user: userInfo().username, uid: process.getuid?.() ?? 0 });
  const hooks = hooksFiles(home, HOOKS_DIR, config.port, await resolveCodexHome({ ...env, ...withLegacyEnv(parseEnvFile(envText)) }, home, io.loginShell));
  const launcherPath = joinPath(home, '.tarfa', 'bin', 'tarfa-agent');
  const log = fx.agentLog ?? agentLog({ home });
  const result = await runApply(
    {
      blocker: async () => {
        if (!(await readFile(config.devicesPath).then(() => true, () => false))) return 'no device roster yet (~/.tarfa/devices.json): run tarfa setup, which writes it before the agent first starts';
        if (stateDirLayout(home) !== 'moved') return '~/.perch has not moved to ~/.tarfa: run tarfa setup, which moves it';
        return null;
      },
      writeLauncher: async () => {
        const wanted = await readFile(LAUNCHER_TEMPLATE, 'utf8');
        if ((await readFile(launcherPath, 'utf8').catch(() => null)) === wanted) return false;
        await atomicWrite(launcherPath, wanted, 0o755);
        return true;
      },
      writeUnit: async () => {
        // Without a reachable user manager nothing below could be told from "not installed".
        const enabled = await service.enabled();
        const wanted = renderService(await service.template(), { kind: 'launcher', path: launcherPath });
        const installed = await service.installed();
        if (enabled && installed === wanted) return { changed: false, kept: null };
        const kept = installed !== null && installed !== wanted ? await service.backup() : null;
        await service.install(wanted);
        return { changed: true, kept };
      },
      writeCliWrapper: async () => {
        const cli = await cliState(home, env);
        const plan = planCli(cli);
        if (plan.writeWrapper !== null) await atomicWrite(cli.wrapper.path, plan.writeWrapper, 0o755);
        if (plan.linkPerch) await linkPerch(cli.perch.path);
        return { changed: plan.writeWrapper !== null || plan.linkPerch, notes: plan.notes };
      },
      installHooks: async () => {
        if (await hooks.current()) return { changed: false, codex: false };
        return { changed: true, ...(await hooks.install()) };
      },
      markLog: () => log.mark(),
      restart: () => (fx.restart ?? agentService()).restart(),
      checkListener: fx.checkListener ?? ((port) => answersUpgrade(port)),
      agentLog: (mark) => log.since(mark),
      sleep: io.sleep ?? ((ms) => new Promise((done) => setTimeout(done, ms))),
    },
    { phonePort: config.phonePort, codexNote: CODEX_NEXT_STEP },
  );
  if (!result.ok) throw new Error(result.lines.join('\n'));
  return result.lines.join('\n');
}

// A code by default: a link looks like something to open, and opened outside the installed app it
// pairs nothing. `--link` is for an app from before codes (an older cached or self-hosted one).
function pairingInstructions(pairing: PairingLink, options: { origin: string; minutes: number; link: boolean }): string {
  const { origin, minutes } = options;
  const text = options.link ? pairingLink(origin, pairing) : pairingCode(pairing);
  const how = options.link
    ? [
        'On the phone, in Tarfa: Settings → Scan QR code, then scan this. Or open the link below on the',
        'phone (Android opens the installed app; on an iPhone copy it and use Settings → Paste pairing link).',
      ]
    : [
        `On the phone, open the Tarfa app (install it from ${origin} first), then Settings → Add machine:`,
        'Scan QR code and scan this, or copy the code below to the phone and tap Paste pairing code.',
      ];
  return [
    ...how,
    '',
    // Half-height blocks: about 60 columns, where `term` needs twice that.
    encodeQR(text, 'ascii', { ecc: 'low' }),
    text,
    '',
    // The phone asks before pairing and shows this fingerprint: they must match.
    `The phone will show machine key ${deviceFingerprint(pairing.agentKey)}; check it matches.`,
    `It works once, for ${minutes} minute${minutes === 1 ? '' : 's'}. \`tarfa pair\` makes another.`,
  ].join('\n');
}

const DICTATION_KEY_USAGE = [
  `usage: tarfa dictation-key [status | set ${DICTATION_PROVIDERS.join('|')} | remove ${DICTATION_PROVIDERS.join('|')}]`,
  '  set     reads the key on stdin, or asks for it with echo off; never as an argument',
  '  every phone paired with this machine dictates into its workspaces with it, at its next connect',
].join('\n');

// The provider keys this machine hands its paired phones. A running agent reads the file on each
// request, so a change reaches a phone at its next connect.
async function dictationKey(store: FileDictationKeysStore, [action = 'status', name, ...extra]: string[], secret: (prompt: string) => Promise<string>): Promise<string> {
  if (action === 'status') {
    if (name !== undefined) throw new UsageError(DICTATION_KEY_USAGE);
    const loaded = await store.load();
    if ('problem' in loaded) throw new Error(loaded.problem);
    return DICTATION_PROVIDERS.map((p) => `${p}  ${loaded.keys[p] ? 'set' : 'not set'}`).join('\n');
  }
  if (action !== 'set' && action !== 'remove') throw new UsageError(DICTATION_KEY_USAGE);
  if (action === 'set' && extra.length > 0) {
    throw new UsageError('pass the key on stdin or type it at the prompt, never as an argument: any local user can read a process\'s arguments');
  }
  const provider = name ? providerOf(name) : null;
  if (!provider || extra.length > 0) throw new UsageError(DICTATION_KEY_USAGE);
  // Said before the key is typed; the update checks again under the lock.
  const loaded = await store.load();
  if ('problem' in loaded) throw new Error(loaded.problem);
  const result = await changeDictationKey(store, provider, action === 'remove' ? null : await secret(`${provider} key: `));
  if (!result.ok) throw new Error(result.error);
  return action === 'remove'
    ? `${provider}: removed; phones stop getting it at their next connect. Rotate it at the provider if a phone that had it is lost`
    : `${provider}: stored; every phone paired with this machine gets it at its next connect`;
}

const DEVICES_USAGE = [
  'usage: tarfa devices [list | revoke <id|key> | forget <id|key> | enrolment open|closed]',
  '  enrolment open    a pairing code from `tarfa pair` enrols a new phone',
  '  enrolment closed  no new phone can enrol',
].join('\n');

const ENROLMENT_MODES: Record<EnrolmentMode, string> = {
  open: 'open (a pairing code from `tarfa pair` enrols a phone)',
  closed: 'closed (no new phone can enrol)',
};

// The phones this agent accepts. A running agent picks up a change within seconds, and closes a
// revoked phone's sessions.
async function devices(store: FileDeviceStore, [action = 'list', arg]: string[]): Promise<string> {
  switch (action) {
    case 'list':
      return formatRoster(await store.read());
    case 'revoke':
    case 'forget': {
      if (!arg) throw new Error(DEVICES_USAGE);
      const found: { device: Device | null } = { device: null };
      await store.update((roster) => {
        const result = action === 'revoke' ? revokeDevice(roster, arg, new Date()) : forgetDevice(roster, arg);
        found.device = result.device;
        return result.roster;
      });
      const { device } = found;
      if (!device) throw new Error(`no single device matches ${arg}; see tarfa devices, and name it by its full key if its id is shared`);
      if (action === 'forget') return `forgot ${device.id} (${sanitizeDeviceName(device.name)}); it can enrol again with a \`tarfa pair\` code`;
      return `revoked ${device.id} (${sanitizeDeviceName(device.name)}); this key stays refused until forgotten`;
    }
    case 'enrolment': {
      if (arg === 'on' || arg === 'off') throw new Error(`token enrolment is gone: phones join only with a \`tarfa pair\` code. Use \`enrolment open\` or \`enrolment closed\``);
      if (arg !== 'open' && arg !== 'closed') throw new Error(DEVICES_USAGE);
      await store.update((roster) => withEnrolmentMode(roster, arg));
      return `enrolment: ${ENROLMENT_MODES[arg]}`;
    }
    default:
      throw new Error(DEVICES_USAGE);
  }
}

function formatRoster(roster: DeviceRoster): string {
  const day = (iso: string) => iso.slice(0, 10);
  const lines = [`enrolment: ${ENROLMENT_MODES[enrolmentMode(roster)]}`];
  for (const d of roster.devices) lines.push(`${d.id}  ${sanitizeDeviceName(d.name)}  enrolled ${day(d.enrolledAt)}  key ${d.x25519}`);
  for (const d of roster.revoked) lines.push(`${d.id}  ${sanitizeDeviceName(d.name)}  revoked ${day(d.revokedAt)}  key ${d.x25519}`);
  if (roster.devices.length + roster.revoked.length === 0) lines.push('no devices');
  return lines.join('\n');
}

if (isEntrypoint(import.meta.url, process.argv[1])) {
  const argv = process.argv.slice(2);
  const program =
    argv[0] === 'serve' && argv.length === 1
      ? import('./serve').then((agent) => agent.main())
      : run(argv, process.env, homedir()).then((out) => {
          process.stdout.write(`${out}\n`);
        });
  program.catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = err instanceof UsageError || err instanceof WaitTimeout ? err.exitCode : ((err as { exitCode?: number }).exitCode ?? 1);
  });
}

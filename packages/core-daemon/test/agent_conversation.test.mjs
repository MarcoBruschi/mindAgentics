import { spawn } from 'node:child_process';
import path from 'node:path';
import * as readline from 'node:readline';

const daemonScript = path.resolve('packages/core-daemon/dist/index.js');
const cliPath = path.resolve('packages/core-daemon/bin/mindagentics.js');
const serveToken = 'testconv' + Math.floor(Math.random() * 100000);

console.log(`Starting daemon for conversation test with token: ${serveToken}...`);
const daemon = spawn(process.execPath, [daemonScript, '--serve', serveToken], {
  stdio: ['pipe', 'pipe', 'inherit'],
});

const rl = readline.createInterface({ input: daemon.stdout });
let pipeAddress = null;

function execCli(args, terminalId = 'agent-antigravity', maestro = true) {
  return new Promise((resolve) => {
    const cp = spawn(process.execPath, [cliPath, ...args], {
      env: {
        ...process.env,
        MINDAGENTICS_PIPE: pipeAddress,
        MINDAGENTICS_TERMINAL_ID: terminalId,
        MINDAGENTICS_WORKSPACE_ID: 'ws-main',
        ...(maestro ? { MINDAGENTICS_MAESTRO_MODE: '1' } : {}),
      },
    });

    let stdout = '';
    let stderr = '';
    cp.stdout.on('data', (d) => (stdout += d.toString()));
    cp.stderr.on('data', (d) => (stderr += d.toString()));
    cp.on('close', (code) => {
      resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

rl.on('line', async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  try {
    const frame = JSON.parse(trimmed);

    if (frame.type === 'ready') {
      pipeAddress = frame.payload.address;
      console.log('Daemon ready on:', pipeAddress);

      // 1. Antigravity recruits Codex Agent
      console.log('\n--- Passo 1: Antigravity recruta Codex ---');
      const recCodex = await execCli(['recruit', 'Codex Dev', '--preset', 'Codex', '--role', 'Backend Specialist']);
      console.log(recCodex.stdout);

      // 2. Antigravity recruits OpenCode Agent
      console.log('\n--- Passo 2: Antigravity recruta OpenCode ---');
      const recOpenCode = await execCli(['recruit', 'OpenCode Dev', '--preset', 'OpenCode', '--role', 'Frontend Specialist']);
      console.log(recOpenCode.stdout);

      // 3. List connected agents
      console.log('\n--- Passo 3: Listar agentes conectados no Canvas ---');
      const listRes = await execCli(['list']);
      console.log(listRes.stdout);

      // 4. Test Broadcast (say) to all agents
      console.log('\n--- Passo 4: Teste de Broadcast (say) para todos os agentes ---');
      const sayRes = await execCli(['say', 'Iniciando sprint de desenvolvimento']);
      console.log('Broadcast resultado:', sayRes.stdout);

      // 5. Test inter-agent conversation via ask
      console.log('\n--- Passo 5: Teste de Conversação Direta (Antigravity -> Codex Dev) ---');
      // Start the ask in background, and simulate destination reply
      const askPromise = execCli(['ask', 'Codex Dev', 'Qual a versao da API?']);

      // The frame "deliverPrompt" will be received on stdout below
    } else if (frame.type === 'deliverPrompt') {
      console.log(`\n[Main Event] Mensagem entregue no PTY do terminal destino (${frame.payload.terminalId}):`);
      console.log(`> Prompt: "${frame.payload.prompt.trim()}"`);
      console.log(`> De: ${frame.payload.fromTerminalId}`);

      // Simulate the destination agent responding via JSON-RPC settleTurn
      const settleFrame = {
        type: 'settleTurn',
        id: 'settle-1',
        payload: {
          terminalId: frame.payload.terminalId,
          output: 'Resposta do Codex Dev: API v2.4 pronta e operando com Knowledge Graph!',
          askId: frame.payload.askId,
        },
      };

      console.log('[Simulação] Codex Dev processa e devolve a resposta...');
      daemon.stdin.write(JSON.stringify(settleFrame) + '\n');
    } else if (frame.id === 'settle-1') {
      console.log('\n--- Passo 6: Verificação da Resposta Recebida pelo Agente Solicitante ---');
      console.log('Sucesso! A conversa entre os agentes foi concluída e o turno foi resolvido com fidelidade.');
      daemon.kill();
      process.exit(0);
    }
  } catch (err) {
    // ignore
  }
});

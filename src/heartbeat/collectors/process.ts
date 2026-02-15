import { execSync } from 'child_process';
import * as net from 'net';

export interface ProcessMetrics {
  watchedProcesses: { name: string; running: boolean; pid?: number; cpu?: number; mem?: number }[];
  portChecks: { port: number; open: boolean; process?: string }[];
}

const DEFAULT_PROCESSES = ['node', 'python', 'docker', 'postgres', 'redis-server'];
const DEFAULT_PORTS = [3000, 5432, 6379, 8080, 18789];

function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(1000);
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
    socket.on('error', () => { resolve(false); });
    socket.connect(port, '127.0.0.1');
  });
}

export async function collect(
  processes?: string[],
  ports?: number[]
): Promise<ProcessMetrics> {
  const watchList = processes ?? DEFAULT_PROCESSES;
  const portList = ports ?? DEFAULT_PORTS;

  // Check processes
  const watchedProcesses = watchList.map((name) => {
    try {
      const output = execSync(
        `ps aux | grep -i "[${name[0]}]${name.slice(1)}" | head -1`,
        { encoding: 'utf-8', timeout: 3000 }
      ).trim();
      if (output) {
        const parts = output.split(/\s+/);
        return {
          name,
          running: true,
          pid: parseInt(parts[1]) || undefined,
          cpu: parseFloat(parts[2]) || undefined,
          mem: parseFloat(parts[3]) || undefined,
        };
      }
      return { name, running: false };
    } catch {
      return { name, running: false };
    }
  });

  // Check ports
  const portChecks = await Promise.all(
    portList.map(async (port) => {
      const open = await checkPort(port);
      let process: string | undefined;
      if (open) {
        try {
          const output = execSync(`lsof -i :${port} -t 2>/dev/null | head -1`, {
            encoding: 'utf-8',
            timeout: 3000,
          }).trim();
          if (output) {
            const pid = parseInt(output);
            const pName = execSync(`ps -p ${pid} -o comm= 2>/dev/null`, {
              encoding: 'utf-8',
              timeout: 3000,
            }).trim();
            process = pName || undefined;
          }
        } catch {}
      }
      return { port, open, process };
    })
  );

  return { watchedProcesses, portChecks };
}

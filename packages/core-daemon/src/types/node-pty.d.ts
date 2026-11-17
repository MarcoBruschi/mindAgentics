declare module 'node-pty' {
  export interface IPtyForkOptions {
    name?: string;
    cols?: number;
    rows?: number;
    cwd?: string;
    env?: { [key: string]: string | undefined };
    encoding?: string | null;
    handleFlowControl?: boolean;
    useConpty?: boolean;
    conptyInheritCursor?: boolean;
  }

  export interface IDisposable {
    dispose(): void;
  }

  export interface IPty {
    readonly pid: number;
    cols: number;
    rows: number;
    readonly process: string;
    handleFlowControl: boolean;
    onData(listener: (data: string) => void): IDisposable;
    onExit(listener: (e: { exitCode: number; signal?: number }) => void): IDisposable;
    write(data: string): void;
    resize(cols: number, rows: number): void;
    kill(signal?: string): void;
    pause(): void;
    resume(): void;
  }

  export function spawn(file: string, args: string[] | string, options: IPtyForkOptions): IPty;
}
